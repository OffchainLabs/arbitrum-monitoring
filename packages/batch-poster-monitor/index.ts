import yargs from 'yargs'
import {
  Log,
  PublicClient,
  createPublicClient,
  decodeFunctionData,
  defineChain,
  formatEther,
  http,
  parseAbi,
} from 'viem'
import { arbitrumNova } from 'viem/chains'
import { AbiEvent } from 'abitype'
import {
  getBatchPosters,
  isAnyTrust as isAnyTrustOrbitChain,
} from '@arbitrum/orbit-sdk'
import {
  getChainFromId,
  getMaxBlockRange,
  getParentChainBlockTimeForBatchPosting,
  MAX_TIMEBOUNDS_SECONDS,
  BATCH_POSTING_TIMEBOUNDS_FALLBACK,
  BATCH_POSTING_TIMEBOUNDS_BUFFER,
  MIN_DAYS_OF_BALANCE_LEFT,
  MAX_LOGS_TO_PROCESS_FOR_BALANCE,
  BATCH_POSTER_BALANCE_ALERT_THRESHOLD_FALLBACK,
  supportedCoreChainIds,
} from './chains'
import { BatchPosterMonitorOptions } from './types'
import { reportBatchPosterErrorToSlack } from './reportBatchPosterAlertToSlack'
import {
  ChildNetwork as ChainInfo,
  DEFAULT_CONFIG_PATH,
  getConfig,
  getExplorerUrlPrefixes,
} from '../utils'

// Parsing command line arguments using yargs
const options: BatchPosterMonitorOptions = yargs(process.argv.slice(2))
  .options({
    configPath: { type: 'string', default: DEFAULT_CONFIG_PATH },
    enableAlerting: { type: 'boolean', default: false },
  })
  .strict()
  .parseSync() as BatchPosterMonitorOptions

const config = getConfig({ configPath: options.configPath })

const sequencerBatchDeliveredEventAbi: AbiEvent = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'uint256',
      name: 'batchSequenceNumber',
      type: 'uint256',
    },
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'beforeAcc',
      type: 'bytes32',
    },
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'afterAcc',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'bytes32',
      name: 'delayedAcc',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'afterDelayedMessagesRead',
      type: 'uint256',
    },
    {
      components: [
        { internalType: 'uint64', name: 'minTimestamp', type: 'uint64' },
        { internalType: 'uint64', name: 'maxTimestamp', type: 'uint64' },
        { internalType: 'uint64', name: 'minBlockNumber', type: 'uint64' },
        { internalType: 'uint64', name: 'maxBlockNumber', type: 'uint64' },
      ],
      indexed: false,
      internalType: 'struct ISequencerInbox.TimeBounds',
      name: 'timeBounds',
      type: 'tuple',
    },
    {
      indexed: false,
      internalType: 'enum ISequencerInbox.BatchDataLocation',
      name: 'dataLocation',
      type: 'uint8',
    },
  ],
  name: 'SequencerBatchDelivered',
  type: 'event',
}

const sequencerInboxAbi = [
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'sequenceNumber',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
      {
        internalType: 'uint256',
        name: 'afterDelayedMessagesRead',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: 'gasRefunder',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'prevMessageCount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'newMessageCount',
        type: 'uint256',
      },
    ],
    name: 'addSequencerL2BatchFromOrigin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

const displaySummaryInformation = ({
  childChainInformation,
  lastBlockReported,
  latestBatchPostedBlockNumber,
  latestBatchPostedSecondsAgo,
  latestChildChainBlockNumber,
  batchPosterBacklogSize,
  batchPostingTimeBounds,
}: {
  childChainInformation: ChainInfo
  lastBlockReported: bigint
  latestBatchPostedBlockNumber: bigint
  latestBatchPostedSecondsAgo: bigint
  latestChildChainBlockNumber: bigint
  batchPosterBacklogSize: bigint
  batchPostingTimeBounds: number
}) => {
  console.log('**********')
  console.log(`Batch poster summary of [${childChainInformation.name}]`)
  console.log(
    `Latest block number on [${childChainInformation.name}] is ${latestChildChainBlockNumber}.`
  )
  console.log(
    `Latest [${
      childChainInformation.name
    }] block included on [Parent chain id: ${
      childChainInformation.parentChainId
    }, block-number ${latestBatchPostedBlockNumber}] is ${lastBlockReported} => ${
      latestBatchPostedSecondsAgo / 60n / 60n
    } hours, ${(latestBatchPostedSecondsAgo / 60n) % 60n} minutes, ${
      latestBatchPostedSecondsAgo % 60n
    } seconds ago.`
  )

  console.log(`Batch poster backlog is ${batchPosterBacklogSize} blocks.`)
  console.log(timeBoundsExpectedMessage(batchPostingTimeBounds))
  console.log('**********')
  console.log('')
}

const allBatchedAlertsContent: string[] = []

const showAlert = (childChainInformation: ChainInfo, reasons: string[]) => {
  const { PARENT_CHAIN_ADDRESS_PREFIX } = getExplorerUrlPrefixes(
    childChainInformation
  )

  reasons
    .reverse()
    .push(
      `SequencerInbox located at <${
        PARENT_CHAIN_ADDRESS_PREFIX +
        childChainInformation.ethBridge.sequencerInbox
      }|${childChainInformation.ethBridge.sequencerInbox}> on [chain id ${
        childChainInformation.parentChainId
      }]`
    )

  const reasonsString = reasons
    .filter(reason => !!reason.trim().length)
    .join('\n• ')

  console.log(`Alert on ${childChainInformation.name}:`)
  console.log(`• ${reasonsString}`)
  console.log('--------------------------------------')
  console.log('')
  allBatchedAlertsContent.push(
    `[${childChainInformation.name}]:\n• ${reasonsString}`
  )
}

type EventLogs = Log<
  bigint,
  number,
  false,
  AbiEvent,
  undefined,
  [AbiEvent],
  string
>[]

const getBatchPosterFromEventLogs = async (
  eventLogs: EventLogs,
  parentChainClient: PublicClient
) => {
  // get the batch-poster for the first event log
  const batchPostingTransactionHash = eventLogs[0].transactionHash
  const tx = await parentChainClient.getTransaction({
    hash: batchPostingTransactionHash,
  })
  return tx.from
}

const getBatchPosterAddress = async (
  parentChainClient: PublicClient,
  childChainInformation: ChainInfo,
  sequencerInboxLogs: EventLogs
) => {
  // if we have sequencer inbox logs, then get the batch poster directly
  if (sequencerInboxLogs.length > 0) {
    return await getBatchPosterFromEventLogs(
      sequencerInboxLogs,
      parentChainClient
    )
  }

  // else derive batch poster from the sdk
  const { batchPosters, isAccurate } = await getBatchPosters(
    //@ts-ignore - PublicClient that we pass vs PublicClient that orbit-sdk expects is not matching
    parentChainClient,
    {
      rollup: childChainInformation.ethBridge.rollup as `0x${string}`,
      sequencerInbox: childChainInformation.ethBridge
        .sequencerInbox as `0x${string}`,
    }
  )

  if (isAccurate) {
    return batchPosters[0] // get the first batch poster
  } else {
    throw Error('Batch poster information not found')
  }
}

const getBatchPosterLowBalanceAlertMessage = async (
  parentChainClient: PublicClient,
  childChainInformation: ChainInfo,
  sequencerInboxLogs: EventLogs
) => {
  const { PARENT_CHAIN_ADDRESS_PREFIX } = getExplorerUrlPrefixes(
    childChainInformation
  )

  const batchPoster = await getBatchPosterAddress(
    parentChainClient,
    childChainInformation,
    sequencerInboxLogs
  )
  const currentBalance = await parentChainClient.getBalance({
    address: batchPoster,
  })

  // if there are no logs, add a static check for low balance
  if (sequencerInboxLogs.length === 0) {
    const bal = Number(formatEther(currentBalance))
    if (bal < BATCH_POSTER_BALANCE_ALERT_THRESHOLD_FALLBACK) {
      return `Low Batch poster balance (<${
        PARENT_CHAIN_ADDRESS_PREFIX + batchPoster
      }|${batchPoster}>): ${formatEther(
        currentBalance
      )} ETH (Minimum expected balance: ${BATCH_POSTER_BALANCE_ALERT_THRESHOLD_FALLBACK} ETH). `
    }
    return null
  }

  // Dynamic balance check based on the logs
  // Extract the most recent logs for processing to avoid overloading with too many logs
  const recentLogs = [...sequencerInboxLogs].slice(
    -MAX_LOGS_TO_PROCESS_FOR_BALANCE
  )

  // Calculate the elapsed time (in seconds) since the first block in the logs
  const firstTransaction = await parentChainClient.getTransaction({
    hash: recentLogs[0].transactionHash,
  })
  const initialBlock = await parentChainClient.getBlock({
    blockNumber: firstTransaction.blockNumber,
  })
  const initialBlockTimestamp = initialBlock.timestamp

  const elapsedTimeSinceFirstBlock =
    BigInt(Math.floor(Date.now() / 1000)) - initialBlockTimestamp

  // Loop through each log and calculate the gas cost for posting batches
  let postingCost = BigInt(0)
  for (const log of recentLogs) {
    const tx = await parentChainClient.getTransactionReceipt({
      hash: log.transactionHash,
    })
    postingCost += tx.gasUsed * tx.effectiveGasPrice // Accumulate the transaction cost
  }

  // Calculate the approximate balance spent over the last 24 hours
  const secondsIn1Day = 24n * 60n * 60n

  const timeRatio =
    secondsIn1Day / elapsedTimeSinceFirstBlock > 1n
      ? secondsIn1Day / elapsedTimeSinceFirstBlock
      : 1n // set minimum cap of the ratio to 1, since we are calculating the cost for 24 hours, else bigInt rounds off the ratio to zero

  const dailyPostingCostEstimate = timeRatio * postingCost

  // Estimate how many days the current balance will last based on the daily cost
  const daysLeftForCurrentBalance = currentBalance / dailyPostingCostEstimate
  console.log(
    `The current batch poster balance is ${formatEther(
      currentBalance
    )} ETH, and balance spent in 24 hours is approx ${formatEther(
      dailyPostingCostEstimate
    )} ETH. The current balance can last approximately ${daysLeftForCurrentBalance} days.`
  )

  // Determine the minimum expected balance needed to maintain operations for a certain number of days
  const minimumExpectedBalance =
    MIN_DAYS_OF_BALANCE_LEFT * dailyPostingCostEstimate

  // Check if the current balance is below the minimum expected balance
  // Return a warning message if low balance is detected
  const lowBalanceDetected = currentBalance < minimumExpectedBalance

  if (lowBalanceDetected) {
    return `Low Batch poster balance (<${
      PARENT_CHAIN_ADDRESS_PREFIX + batchPoster
    }|${batchPoster}>): ${formatEther(
      currentBalance
    )} ETH (Minimum expected balance: ${formatEther(
      minimumExpectedBalance
    )} ETH). The current balance is expected to last for ~${daysLeftForCurrentBalance} days only.`
  }

  return null
}

const checkForUserTransactionBlocks = async ({
  fromBlock,
  toBlock,
  publicClient,
}: {
  fromBlock: number
  toBlock: number
  publicClient: PublicClient
}) => {
  const MINER_OF_USER_TX_BLOCKS = '0xa4b000000000000000000073657175656e636572' // this will be the miner address if a block contains user tx

  let userTransactionBlockFound = false

  for (let i = fromBlock; i <= toBlock; i++) {
    const block = await publicClient.getBlock({ blockNumber: BigInt(i) })
    if (block.miner === MINER_OF_USER_TX_BLOCKS) {
      userTransactionBlockFound = true
      break
    }
  }

  return userTransactionBlockFound
}

const getBatchPostingTimeBounds = async (
  childChainInformation: ChainInfo,
  parentChainClient: PublicClient
) => {
  let batchPostingTimeBounds = BATCH_POSTING_TIMEBOUNDS_FALLBACK
  try {
    const maxTimeVariation = await parentChainClient.readContract({
      address: childChainInformation.ethBridge.sequencerInbox as `0x${string}`,
      abi: parseAbi([
        'function maxTimeVariation() view returns (uint256, uint256, uint256, uint256)',
      ]),
      functionName: 'maxTimeVariation',
    })

    const delayBlocks = Number(maxTimeVariation[0])
    const delaySeconds = Number(maxTimeVariation[2].toString())

    // use the minimum of delayBlocks or delay seconds
    batchPostingTimeBounds = Math.min(
      delayBlocks *
        getParentChainBlockTimeForBatchPosting(childChainInformation),
      delaySeconds
    )
  } catch (_) {
    // no-op, use the fallback value
  }

  // formula : min(50% of x , max(1h, x - buffer))
  // minimum of half of the batchPostingTimeBounds vs [1 hour vs batchPostingTimeBounds - buffer]
  return Math.min(
    0.65 * batchPostingTimeBounds,
    Math.max(3600, batchPostingTimeBounds - BATCH_POSTING_TIMEBOUNDS_BUFFER)
  )
}

const timeBoundsExpectedMessage = (batchPostingTimebounds: number) =>
  `At least 1 batch is expected to be posted every ${
    batchPostingTimebounds / 60 / 60
  } hours.`

const isAnyTrust = async (
  childChainInformation: ChainInfo,
  parentChainClient: PublicClient
) => {
  const { chainId } = childChainInformation

  const anyTrustCoreChainIds = [arbitrumNova.id] as number[] // core chains that we know are AnyTrust

  // if chainId being passed is a core chainId
  if (supportedCoreChainIds.includes(chainId)) {
    // then return true if it's in anyTrust, else false
    return anyTrustCoreChainIds.includes(chainId)
  }

  return isAnyTrustOrbitChain({
    publicClient: parentChainClient as any,
    rollup: childChainInformation.ethBridge.rollup as `0x${string}`,
  })
}

const monitorBatchPoster = async (childChainInformation: ChainInfo) => {
  const alertsForChildChain: string[] = []

  const parentChain = getChainFromId(childChainInformation.parentChainId)
  const childChain = defineChain({
    id: childChainInformation.chainId,
    name: childChainInformation.name,
    network: 'childChain',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [childChainInformation.orbitRpcUrl],
      },
      public: {
        http: [childChainInformation.orbitRpcUrl],
      },
    },
  })

  const parentChainClient = createPublicClient({
    chain: parentChain,
    transport: http(childChainInformation.parentRpcUrl),
  })
  const childChainClient = createPublicClient({
    chain: childChain,
    transport: http(childChainInformation.orbitRpcUrl),
  })

  // Getting sequencer inbox logs
  const latestBlockNumber = await parentChainClient.getBlockNumber()

  const blocksToProcess = getMaxBlockRange(parentChain)
  const toBlock = latestBlockNumber
  const fromBlock = toBlock - blocksToProcess

  // if the block range provided is >=MAX_BLOCKS_TO_PROCESS, we might get rate limited while fetching logs from the node
  // so we break down the range into smaller chunks and process them sequentially
  // generate the final ranges' batches to process [ [fromBlock, toBlock], [fromBlock, toBlock], ...]
  const ranges = [],
    fromBlockNum = Number(fromBlock.toString()),
    toBlockNum = Number(toBlock.toString())

  const MAX_BLOCKS_TO_PROCESS =
    childChainInformation.parentChainId === 1 ? 500 : 500000 // for Ethereum, have lower block range to avoid rate limiting

  for (let i = fromBlockNum; i <= toBlockNum; i += MAX_BLOCKS_TO_PROCESS) {
    ranges.push([i, Math.min(i + MAX_BLOCKS_TO_PROCESS - 1, toBlockNum)])
  }

  const sequencerInboxLogsArray = []
  for (const range of ranges) {
    const logs = await parentChainClient.getLogs({
      address: childChainInformation.ethBridge.sequencerInbox as `0x${string}`,
      event: sequencerBatchDeliveredEventAbi,
      fromBlock: BigInt(range[0]),
      toBlock: BigInt(range[1]),
    })
    sequencerInboxLogsArray.push(logs)
  }

  // Flatten the array of arrays to get final array of logs
  const sequencerInboxLogs = sequencerInboxLogsArray.flat()

  // First, a basic check to get batch poster balance
  const batchPosterLowBalanceMessage =
    await getBatchPosterLowBalanceAlertMessage(
      parentChainClient,
      childChainInformation,
      sequencerInboxLogs
    )
  if (batchPosterLowBalanceMessage) {
    alertsForChildChain.push(batchPosterLowBalanceMessage)
  }

  const batchPostingTimeBounds = await getBatchPostingTimeBounds(
    childChainInformation,
    parentChainClient
  )

  // Get the last block of the chain
  const latestChildChainBlockNumber = await childChainClient.getBlockNumber()

  if (!sequencerInboxLogs || sequencerInboxLogs.length === 0) {
    // get the last block that is 'safe' ie. can be assumed to have been posted
    const latestChildChainSafeBlock = await childChainClient.getBlock({
      blockTag: 'safe',
    })

    const blocksPendingToBePosted =
      latestChildChainBlockNumber - latestChildChainSafeBlock.number

    const doPendingBlocksContainUserTransactions =
      await checkForUserTransactionBlocks({
        fromBlock: Number(latestChildChainSafeBlock.number + 1n), // start checking AFTER the latest 'safe' block
        toBlock: Number(latestChildChainBlockNumber),
        publicClient: childChainClient,
      })

    const batchPostingBacklog =
      blocksPendingToBePosted > 0n && doPendingBlocksContainUserTransactions

    // if alert situation
    if (batchPostingBacklog) {
      alertsForChildChain.push(
        `No batch has been posted in the last ${
          MAX_TIMEBOUNDS_SECONDS / 60 / 60
        } hours, and last block number (${latestChildChainBlockNumber}) is greater than the last safe block number (${
          latestChildChainSafeBlock.number
        }). ${timeBoundsExpectedMessage(batchPostingTimeBounds)}`
      )

      showAlert(childChainInformation, alertsForChildChain)
    } else {
      // if no alerting situation, just log the summary
      console.log(
        `**********\nBatch poster summary of [${childChainInformation.name}]`
      )
      console.log(
        `No user activity in the last ${
          MAX_TIMEBOUNDS_SECONDS / 60 / 60
        } hours, and hence no batch has been posted.\n`
      )

      // in this case show alert only if batch poster balance is low
      if (batchPosterLowBalanceMessage) {
        showAlert(childChainInformation, alertsForChildChain)
      }
    }
    return
  }

  // Get the latest log
  const lastSequencerInboxLog = sequencerInboxLogs.pop()

  const isChainAnyTrust = await isAnyTrust(
    childChainInformation,
    parentChainClient
  )

  if (isChainAnyTrust) {
    const alerts = await checkIfAnyTrustRevertedToPostDataOnChain({
      parentChainClient,
      childChainInformation,
      lastSequencerInboxLog,
    })
    alertsForChildChain.push(...alerts)
  }
  // Get the timestamp of the block where that log was emitted
  const lastSequencerInboxBlock = await parentChainClient.getBlock({
    blockNumber: lastSequencerInboxLog!.blockNumber,
  })
  const lastBatchPostedTime = lastSequencerInboxBlock.timestamp
  const secondsSinceLastBatchPoster =
    BigInt(Math.floor(Date.now() / 1000)) - lastBatchPostedTime

  // Get last block that's part of a batch
  const lastBlockReported = await parentChainClient.readContract({
    address: childChainInformation.ethBridge.bridge as `0x${string}`,
    abi: parseAbi([
      'function sequencerReportedSubMessageCount() view returns (uint256)',
    ]),
    functionName: 'sequencerReportedSubMessageCount',
  })

  // Get batch poster backlog
  const batchPosterBacklog = latestChildChainBlockNumber - lastBlockReported

  // If there's backlog and last batch posted was 4 hours ago, send alert
  if (
    batchPosterBacklog > 0 &&
    secondsSinceLastBatchPoster > BigInt(batchPostingTimeBounds)
  ) {
    alertsForChildChain.push(
      `Last batch was posted ${
        secondsSinceLastBatchPoster / 60n / 60n
      } hours and ${
        (secondsSinceLastBatchPoster / 60n) % 60n
      } mins ago, and there's a backlog of ${batchPosterBacklog} blocks in the chain. ${timeBoundsExpectedMessage(
        batchPostingTimeBounds
      )}`
    )
  }

  if (alertsForChildChain.length > 0) {
    showAlert(childChainInformation, alertsForChildChain)
    return
  }

  displaySummaryInformation({
    childChainInformation,
    lastBlockReported,
    latestBatchPostedBlockNumber: lastSequencerInboxBlock.number,
    latestBatchPostedSecondsAgo: secondsSinceLastBatchPoster,
    latestChildChainBlockNumber,
    batchPosterBacklogSize: batchPosterBacklog,
    batchPostingTimeBounds,
  })
}

const main = async () => {
  // log the chains being processed for better debugging in github actions
  console.log(
    '>>>>>> Processing chains: ',
    config.childChains.map((chainInformation: ChainInfo) => ({
      name: chainInformation.name,
      chainID: chainInformation.chainId,
      rpc: chainInformation.orbitRpcUrl,
    }))
  )

  // process each chain sequentially to avoid RPC rate limiting
  for (const childChain of config.childChains) {
    try {
      console.log('>>>>> Processing chain: ', childChain.name)
      await monitorBatchPoster(childChain)
    } catch (e) {
      const errorStr = `Batch Posting alert on [${childChain.name}]:\nError processing chain: ${e.message}`
      if (options.enableAlerting) {
        await reportBatchPosterErrorToSlack({
          message: errorStr,
        })
      }
      console.error(errorStr)
    }
  }

  if (options.enableAlerting && allBatchedAlertsContent.length > 0) {
    const finalMessage = `Batch poster monitor summary \n\n${allBatchedAlertsContent.join(
      '\n--------------------------------------\n'
    )}`

    console.log(finalMessage)
    await reportBatchPosterErrorToSlack({
      message: finalMessage,
    })
  }
}

const checkIfAnyTrustRevertedToPostDataOnChain = async ({
  parentChainClient,
  childChainInformation,
  lastSequencerInboxLog,
}: {
  parentChainClient: PublicClient
  childChainInformation: ChainInfo
  lastSequencerInboxLog:
    | Log<bigint, number, false, AbiEvent, undefined, [AbiEvent], string>
    | undefined
}): Promise<string[]> => {
  const alerts = []

  try {
    // Get the transaction that emitted `lastSequencerInboxLog`
    const transaction = await parentChainClient.getTransaction({
      hash: lastSequencerInboxLog?.transactionHash as `0x${string}`,
    })

    const { args } = decodeFunctionData({
      abi: sequencerInboxAbi,
      data: transaction.input,
    })

    // Extract the 'data' field
    const batchData = args[1] as `0x${string}`

    // Check the first byte of the data
    const firstByte = batchData.slice(0, 4)

    if (firstByte === '0x00') {
      alerts.push(
        `AnyTrust chain [${childChainInformation.name}] has fallen back to posting calldata on-chain. This indicates a potential issue with the Data Availability Committee.`
      )
    } else if (firstByte === '0x88') {
      console.log(
        `Chain [${childChainInformation.name}] is using AnyTrust DACert as expected.`
      )
    } else {
      console.log(
        `Chain [${childChainInformation.name}] is using an unknown data format. First byte: ${firstByte}`
      )
    }
  } catch (e) {
    console.log(
      `Chain [${childChainInformation.name}]: Error checking if AnyTrust reverted to posting calldata on-chain: ${e.message}`
    )
  }

  return alerts
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
