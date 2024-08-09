import * as fs from 'fs'
import * as path from 'path'
import yargs from 'yargs'
import {
  Log,
  PublicClient,
  createPublicClient,
  defineChain,
  formatEther,
  http,
  parseAbi,
} from 'viem'
import { AbiEvent } from 'abitype'
import { getBatchPosters } from '@arbitrum/orbit-sdk'
import {
  getChainFromId,
  getMaxBlockRange,
  getParentChainBlockTimeForBatchPosting,
  MAX_TIMEBOUNDS_SECONDS,
  BATCH_POSTING_TIMEBOUNDS_FALLBACK,
  BATCH_POSTING_TIMEBOUNDS_BUFFER,
  DAYS_OF_BALANCE_LEFT,
} from './chains'
import { BatchPosterMonitorOptions } from './types'
import { reportBatchPosterErrorToSlack } from './reportBatchPosterAlertToSlack'
import { ChildNetwork as ChainInfo, getExplorerUrlPrefixes } from '../utils'

// Parsing command line arguments using yargs
const options: BatchPosterMonitorOptions = yargs(process.argv.slice(2))
  .options({
    configPath: { type: 'string', default: 'config.json' },
    enableAlerting: { type: 'boolean', default: false },
  })
  .strict()
  .parseSync() as BatchPosterMonitorOptions

// Read the content of the config file
const configFileContent = fs.readFileSync(
  path.join(process.cwd(), options.configPath),
  'utf-8'
)

// Parse the config file content as JSON
const config = JSON.parse(configFileContent)

// Check if chains array is present in the config file
if (!Array.isArray(config.childChains) || config?.childChains?.length === 0) {
  console.error('Error: Chains not found in the config file.')
  process.exit(1)
}

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

const getBatchPosterLowBalanceAlertMessage = async (
  parentChainClient: PublicClient,
  childChainInformation: ChainInfo,
  sequencerInboxLogs: EventLogs
) => {
  let batchPoster: `0x${string}` | null = null

  // try fetching batch poster address from orbit-sdk
  try {
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
      batchPoster = batchPosters[0] // get the first batch poster
    } else {
      throw Error('Batch poster list is not accurate') // get the batch poster from the event logs in catch block
    }
  } catch {
    // else try fetching the batch poster from the event logs
    try {
      batchPoster = await getBatchPosterFromEventLogs(
        sequencerInboxLogs,
        parentChainClient
      )
    } catch {
      // batchPoster not found by any means
      return 'Batch poster information not found'
    }
  }

  const currentBalance = await parentChainClient.getBalance({
    address: batchPoster,
  })

  // get the gas used in the last 24 hours
  let gasUsedInLast24Hours = BigInt(0)

  for (const log of sequencerInboxLogs) {
    gasUsedInLast24Hours += (
      await parentChainClient.getTransactionReceipt({
        hash: log.transactionHash,
      })
    ).gasUsed
  }
  const currentGasPrice = await parentChainClient.getGasPrice()
  const balanceSpentIn24Hours = gasUsedInLast24Hours * currentGasPrice

  const minimumExpectedBalance = DAYS_OF_BALANCE_LEFT * balanceSpentIn24Hours // 2 days worth of balance
  const lowBalanceDetected = currentBalance < minimumExpectedBalance

  console.log({
    sequencerInboxLogsLength: sequencerInboxLogs.length,
    gasUsedInLast24Hours,
    currentGasPrice,
    balanceSpentIn24Hours,
    currentBalance,
    minimumExpectedBalance,
    lowBalanceDetected,
  })

  if (lowBalanceDetected) {
    const { PARENT_CHAIN_ADDRESS_PREFIX } = getExplorerUrlPrefixes(
      childChainInformation
    )
    return `Low Batch poster balance (<${
      PARENT_CHAIN_ADDRESS_PREFIX + batchPoster
    }|${batchPoster}>): ${formatEther(
      currentBalance
    )} ETH (Expected balance: ${formatEther(minimumExpectedBalance)} ETH)`
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
    0.5 * batchPostingTimeBounds,
    Math.max(3600, batchPostingTimeBounds - BATCH_POSTING_TIMEBOUNDS_BUFFER)
  )
}

const timeBoundsExpectedMessage = (batchPostingTimebounds: number) =>
  `At least 1 batch is expected to be posted every ${
    batchPostingTimebounds / 60 / 60
  } hours.`

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
    }
    return
  }

  // Get the latest log
  const lastSequencerInboxLog = sequencerInboxLogs.pop()

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
        reportBatchPosterErrorToSlack({
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

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
