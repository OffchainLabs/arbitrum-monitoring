import * as fs from 'fs'
import * as path from 'path'
import yargs from 'yargs'
import {
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
  getDefaultBlockRange,
  DEFAULT_TIMESPAN_SECONDS,
  DEFAULT_BATCH_POSTING_DELAY_SECONDS,
  LOW_ETH_BALANCE_THRESHOLD_ETHEREUM,
  LOW_ETH_BALANCE_THRESHOLD_ARBITRUM,
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

const displaySummaryInformation = (
  childChainInformation: ChainInfo,
  latestBatchPostedBlockNumber: bigint,
  latestBatchPostedSecondsAgo: bigint,
  latestChildChainBlockNumber: bigint,
  batchPosterBacklogSize: bigint
) => {
  console.log('**********')
  console.log(`Batch poster summary of [${childChainInformation.name}]`)
  console.log(
    `Latest block number on [${childChainInformation.name}] is ${latestChildChainBlockNumber}.`
  )
  console.log(
    `Latest batch posted on [Parent chain id: ${
      childChainInformation.parentChainId
    }] is ${latestBatchPostedBlockNumber} => ${
      latestBatchPostedSecondsAgo / 60n / 60n
    } hours, ${(latestBatchPostedSecondsAgo / 60n) % 60n} minutes, ${
      latestBatchPostedSecondsAgo % 60n
    } seconds ago.`
  )

  console.log(`Batch poster backlog is ${batchPosterBacklogSize} blocks.`)
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

const getBatchPosterLowBalanceAlertMessage = async (
  parentChainClient: PublicClient,
  childChainInformation: ChainInfo
) => {
  //@ts-ignore - PublicClient that we pass vs PublicClient that orbit-sdk expects is not matching
  const { batchPosters } = await getBatchPosters(parentChainClient, {
    rollup: childChainInformation.ethBridge.rollup as `0x${string}`,
    sequencerInbox: childChainInformation.ethBridge
      .sequencerInbox as `0x${string}`,
  })
  if (!batchPosters || batchPosters.length === 0) {
    return `Batch poster information not found`
  }

  const batchPoster = batchPosters[0]

  const balance = await parentChainClient.getBalance({
    address: batchPoster,
  })

  const lowBalanceDetected =
    (childChainInformation.parentChainId === 1 &&
      balance < BigInt(LOW_ETH_BALANCE_THRESHOLD_ETHEREUM * 1e18)) ||
    (childChainInformation.parentChainId !== 1 &&
      balance < BigInt(LOW_ETH_BALANCE_THRESHOLD_ARBITRUM * 1e18))

  if (lowBalanceDetected) {
    const { PARENT_CHAIN_ADDRESS_PREFIX } = getExplorerUrlPrefixes(
      childChainInformation
    )
    return `Low Batch poster balance (<${
      PARENT_CHAIN_ADDRESS_PREFIX + batchPoster
    }|${batchPoster}>): ${formatEther(balance)} ETH`
  }

  return null
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

  // First, a basic check to get batch poster balance
  const batchPosterLowBalanceMessage =
    await getBatchPosterLowBalanceAlertMessage(
      parentChainClient,
      childChainInformation
    )
  if (batchPosterLowBalanceMessage) {
    alertsForChildChain.push(batchPosterLowBalanceMessage)
  }

  // Getting sequencer inbox logs
  const latestBlockNumber = await parentChainClient.getBlockNumber()

  const blocksToProcess = getDefaultBlockRange(parentChain)
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

  // Get the last block of the chain
  const latestChildChainBlockNumber = await childChainClient.getBlockNumber()

  if (!sequencerInboxLogs || sequencerInboxLogs.length === 0) {
    // No SequencerInboxLog in the last 12 hours (time hardcoded in getDefaultBlockRange)
    // We compare the "latest" and "safe" blocks
    // NOTE: another way of verifying this might be to check the timestamp of the last block in the childChain chain to verify more or less if it should have been posted
    const latestChildChainSafeBlock = await childChainClient.getBlock({
      blockTag: 'safe',
    })
    if (latestChildChainSafeBlock.number < latestChildChainBlockNumber) {
      alertsForChildChain.push(
        `No batch has been posted in the last ${
          DEFAULT_TIMESPAN_SECONDS / 60 / 60
        } hours, and last block number (${latestChildChainBlockNumber}) is greater than the last safe block number (${
          latestChildChainSafeBlock.number
        })`
      )

      showAlert(childChainInformation, alertsForChildChain)
      return
    }
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
  const batchPosterBacklog =
    latestChildChainBlockNumber - lastBlockReported - 1n

  // If there's backlog and last batch posted was 4 hours ago, send alert
  if (
    batchPosterBacklog > 0 &&
    secondsSinceLastBatchPoster > DEFAULT_BATCH_POSTING_DELAY_SECONDS
  ) {
    alertsForChildChain.push(
      `Last batch was posted ${
        secondsSinceLastBatchPoster / 60n / 60n
      } hours and ${
        (secondsSinceLastBatchPoster / 60n) % 60n
      } mins ago, and there's a backlog of ${batchPosterBacklog} blocks in the chain`
    )
  }

  if (alertsForChildChain.length > 0) {
    showAlert(childChainInformation, alertsForChildChain)
    return
  }

  displaySummaryInformation(
    childChainInformation,
    lastSequencerInboxBlock.number,
    secondsSinceLastBatchPoster,
    latestChildChainBlockNumber,
    batchPosterBacklog
  )
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
    reportBatchPosterErrorToSlack({
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
