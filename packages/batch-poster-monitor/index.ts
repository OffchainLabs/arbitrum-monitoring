import * as fs from 'fs'
import * as path from 'path'
import yargs from 'yargs'
import { AbiEvent, createPublicClient, defineChain, http, parseAbi } from 'viem'
import {
  getChainFromId,
  getDefaultBlockRange,
  DEFAULT_TIMESPAN_SECONDS,
  DEFAULT_BATCH_POSTING_DELAY_SECONDS,
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
    `Latest batch posted on [Parent chain id: ${childChainInformation.partnerChainID}] is ${latestBatchPostedBlockNumber}, ${latestBatchPostedSecondsAgo} seconds ago.`
  )

  console.log(`Batch poster backlog is ${batchPosterBacklogSize} blocks.`)
  console.log('**********')
  console.log('')
}

const showAlert = (childChainInformation: ChainInfo, reason: string) => {
  const { PARENT_CHAIN_ADDRESS_PREFIX } = getExplorerUrlPrefixes(
    childChainInformation
  )

  console.log(`Alert on ${childChainInformation.name}`)
  console.log('--------------------------------------')
  console.log(reason)
  console.log(
    `SequencerInbox located at <${
      PARENT_CHAIN_ADDRESS_PREFIX +
      childChainInformation.ethBridge.sequencerInbox
    }|${childChainInformation.ethBridge.sequencerInbox}> on [chain id ${
      childChainInformation.partnerChainID
    }]`
  )
  console.log('--------------------------------------')
  console.log('')

  if (options.enableAlerting) {
    reportBatchPosterErrorToSlack({
      message: `Alert on ${childChainInformation.name}: ${reason}`,
    })
  }
}

const monitorBatchPoster = async (childChainInformation: ChainInfo) => {
  const parentChain = getChainFromId(childChainInformation.partnerChainID)
  const childChain = defineChain({
    id: childChainInformation.chainID,
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
    transport: http(),
  })
  const childChainClient = createPublicClient({
    chain: childChain,
    transport: http(),
  })

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
    childChainInformation.partnerChainID === 1 ? 800 : 500000 // for Ethereum, have lower block range to avoid rate limiting

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
      showAlert(
        childChainInformation,
        `No batch has been posted in the last ${
          DEFAULT_TIMESPAN_SECONDS / 60 / 60
        } hours, and last block number (${latestChildChainBlockNumber}) is greater than the last safe block number (${
          latestChildChainSafeBlock.number
        })`
      )
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
    showAlert(
      childChainInformation,
      `Last batch was posted ${
        secondsSinceLastBatchPoster / 60n / 60n
      } hours and ${
        (secondsSinceLastBatchPoster / 60n) % 60n
      } mins ago, and there's a backlog of ${batchPosterBacklog} blocks in the chain`
    )
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
      chainID: chainInformation.chainID,
      rpc: chainInformation.orbitRpcUrl,
    }))
  )

  // process each chain sequentially to avoid RPC rate limiting
  for (const childChain of config.childChains) {
    try {
      console.log('>>>>> Processing chain: ', childChain.name)
      await monitorBatchPoster(childChain)
    } catch (e) {
      const errorStr = `Batch poster monitor - Error processing chain [${childChain.name}]: ${e.message}`
      if (options.enableAlerting) {
        reportBatchPosterErrorToSlack({
          message: errorStr,
        })
      }
      console.error(errorStr)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
