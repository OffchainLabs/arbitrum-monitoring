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
import { BatchPosterMonitorOptions, ChainInfo } from './types'
import { reportBatchPosterErrorToSlack } from './reportBatchPosterAlertToSlack'

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
if (!Array.isArray(config.chains) || config?.chains?.length === 0) {
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
  childChainChainInformation: ChainInfo,
  latestBatchPostedBlockNumber: bigint,
  latestBatchPostedSecondsAgo: bigint,
  latestChildChainBlockNumber: bigint,
  batchPosterBacklogSize: bigint
) => {
  console.log('**********')
  console.log(`Batch poster summary of [${childChainChainInformation.name}]`)
  console.log(
    `Latest block number on [${childChainChainInformation.name}] is ${latestChildChainBlockNumber}.`
  )
  console.log(
    `Latest batch posted on [Parent chain id: ${childChainChainInformation.parentChainId}] is ${latestBatchPostedBlockNumber}, ${latestBatchPostedSecondsAgo} seconds ago.`
  )

  console.log(`Batch poster backlog is ${batchPosterBacklogSize} blocks.`)
  console.log('**********')
  console.log('')
}

const showAlert = (childChainChainInformation: ChainInfo, reason: string) => {
  console.log(`Alert on ${childChainChainInformation.name}`)
  console.log('--------------------------------------')
  console.log(reason)
  console.log(
    `SequencerInbox located at ${childChainChainInformation.sequencerInbox} on chain ${childChainChainInformation.parentChainId}`
  )
  console.log('--------------------------------------')
  console.log('')

  if (options.enableAlerting) {
    reportBatchPosterErrorToSlack({
      message: `Alert on ${childChainChainInformation.name}: ${reason}`,
    })
  }
}

const monitorBatchPoster = async (childChainChainInformation: ChainInfo) => {
  const parentChain = getChainFromId(childChainChainInformation.parentChainId)
  const childChainChain = defineChain({
    id: childChainChainInformation.chainId,
    name: childChainChainInformation.name,
    network: 'childChain',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [childChainChainInformation.rpc],
      },
      public: {
        http: [childChainChainInformation.rpc],
      },
    },
  })

  const parentChainClient = createPublicClient({
    chain: parentChain,
    transport: http(),
  })
  const childChainChainClient = createPublicClient({
    chain: childChainChain,
    transport: http(),
  })

  // Getting sequencer inbox logs
  const latestBlockNumber = await parentChainClient.getBlockNumber()
  const sequencerInboxLogs = await parentChainClient.getLogs({
    address: childChainChainInformation.sequencerInbox,
    event: sequencerBatchDeliveredEventAbi,
    fromBlock: latestBlockNumber - getDefaultBlockRange(parentChain),
    toBlock: latestBlockNumber,
  })

  // Get the last block of the chain
  const latestChildChainBlockNumber =
    await childChainChainClient.getBlockNumber()

  if (!sequencerInboxLogs) {
    // No SequencerInboxLog in the last 12 hours (time hardcoded in getDefaultBlockRange)
    // We compare the "latest" and "safe" blocks
    // NOTE: another way of verifying this might be to check the timestamp of the last block in the childChain chain to verify more or less if it should have been posted
    const latestChildChainSafeBlock = await childChainChainClient.getBlock({
      blockTag: 'safe',
    })
    if (latestChildChainSafeBlock.number < latestChildChainBlockNumber) {
      showAlert(
        childChainChainInformation,
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
    address: childChainChainInformation.bridge,
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
      childChainChainInformation,
      `Last batch was posted ${
        secondsSinceLastBatchPoster / 60n / 60n
      } hours ago, and there's a backlog of ${batchPosterBacklog} blocks in the chain`
    )
    return
  }

  displaySummaryInformation(
    childChainChainInformation,
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
    config.chains.map((chainInformation: ChainInfo) => ({
      name: chainInformation.name,
      chainID: chainInformation.chainId,
      rpc: chainInformation.rpc,
    }))
  )

  await Promise.all(
    config.chains.map(async (chainInformation: ChainInfo) => {
      await monitorBatchPoster(chainInformation)
    })
  )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
