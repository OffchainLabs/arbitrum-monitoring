import * as fs from 'fs'
import * as path from 'path'
import { PublicClient, createPublicClient, defineChain, http } from 'viem'
import yargs from 'yargs'
import {
  ChildNetwork as ChainInfo,
  DEFAULT_CONFIG_PATH,
  getConfig,
  sleep,
} from '../utils'
import { nodeCreatedEventAbi } from './abi'
import {
  getBlockTimeForChain,
  getChainFromId,
  getDefaultBlockRange,
} from './chains'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'

const CHUNK_SIZE = 800n
const RETRIES = 3

const options = yargs(process.argv.slice(2))
  .options({
    configPath: { type: 'string', default: DEFAULT_CONFIG_PATH },
    enableAlerting: { type: 'boolean', default: false },
  })
  .strict()
  .parseSync()

const config = getConfig(options)

if (!Array.isArray(config.childChains) || config.childChains.length === 0) {
  console.error('Error: Chains not found in the config file.')
  process.exit(1)
}

type ChunkProcessFunction<T> = (
  fromBlock: bigint,
  toBlock: bigint,
  client: PublicClient
) => Promise<T>

async function processChunkedRange<T>(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
  client: PublicClient,
  processChunk: ChunkProcessFunction<T>
): Promise<T[]> {
  const results: T[] = []

  if (fromBlock === toBlock) {
    return results
  }

  let currentFromBlock = fromBlock

  while (currentFromBlock <= toBlock) {
    const currentToBlock =
      currentFromBlock + chunkSize - 1n < toBlock
        ? currentFromBlock + chunkSize - 1n
        : toBlock

    const result = await processChunk(currentFromBlock, currentToBlock, client)
    results.push(result)

    if (currentToBlock === toBlock) break

    currentFromBlock = currentToBlock + 1n
  }

  return results
}

const getBlockRange = async (
  client: PublicClient,
  childChainInfo: ChainInfo
) => {
  const latestBlockNumber = await client.getBlockNumber()
  const blockRange = getDefaultBlockRange(
    getChainFromId(childChainInfo.parentChainId)
  )

  const fromBlock = await client.getBlock({
    blockNumber: latestBlockNumber - BigInt(blockRange),
  })

  return { fromBlock: fromBlock.number, toBlock: latestBlockNumber }
}

const monitorNodeCreatedEvents = async (childChainInfo: ChainInfo) => {
  const parentChain = getChainFromId(childChainInfo.parentChainId)
  const client = createPublicClient({
    chain: parentChain,
    transport: http(childChainInfo.parentRpcUrl),
  })

  const { fromBlock, toBlock } = await getBlockRange(client, childChainInfo)

  const getLogsForChunk = async (
    chunkFromBlock: bigint,
    chunkToBlock: bigint,
    client: PublicClient
  ) => {
    let attempts = 0

    while (attempts < RETRIES) {
      try {
        return client.getLogs({
          address: childChainInfo.ethBridge.rollup as `0x${string}`,
          event: nodeCreatedEventAbi,
          fromBlock: chunkFromBlock,
          toBlock: chunkToBlock,
        })
      } catch (error) {
        attempts++
        if (attempts >= RETRIES) {
          console.error(`Failed to get logs after ${RETRIES} attempts:`, error)
          throw error
        }
        console.warn(`Attempt ${attempts} failed. Retrying...`)
        await sleep(1000 * attempts)
      }
    }
    return null
  }

  const logsArray = await processChunkedRange(
    fromBlock,
    toBlock,
    CHUNK_SIZE,
    client,
    getLogsForChunk
  )

  const logs = logsArray.flat()

  const getDurationInDays = (fromBlock: bigint, toBlock: bigint) => {
    const blockTime = getBlockTimeForChain(parentChain)
    return (Number(toBlock - fromBlock) * blockTime) / 60 / 60 / 24
  }
  const durationInDays = getDurationInDays(fromBlock, toBlock)

  const durationString = `in the last ${
    durationInDays === 1 ? ' day' : durationInDays + ' days'
  }`

  const childChain = defineChain({
    id: childChainInfo.chainId,
    name: childChainInfo.name,
    network: 'childChain',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [childChainInfo.orbitRpcUrl],
      },
      public: {
        http: [childChainInfo.orbitRpcUrl],
      },
    },
  })

  const childChainClient = createPublicClient({
    chain: childChain,
    transport: http(childChainInfo.orbitRpcUrl),
  })

  const latestSafeBlock = await childChainClient.getBlock({
    blockTag: 'safe',
  })
  const timestampOfLatestSafeBlock =
    new Date(Number(latestSafeBlock.timestamp) * 1000).toLocaleString() + ' UTC'

  const isLatestSafeBlockWithinRange =
    latestSafeBlock.number < toBlock && latestSafeBlock.number > fromBlock

  if (!logs || logs.length === 0) {
    return {
      chainName: childChainInfo.name,
      alertMessage: `No assertion creation events found on ${
        childChainInfo.name
      } ${durationString}. Latest batch ${
        isLatestSafeBlockWithinRange ? 'was' : 'was not'
      } posted within this duration, at ${timestampOfLatestSafeBlock} (block ${
        latestSafeBlock.number
      })`,
    }
  } else {
    console.log(
      `Found ${logs.length} assertion creation event(s) on ${childChainInfo.name} ${durationString}.`
    )
    return null
  }
}

const main = async () => {
  try {
    const alerts: { chainName: string; alertMessage: string }[] = []

    for (const chainInfo of config.childChains) {
      console.log(
        `Checking for assertion creation events on ${chainInfo.name}...`
      )
      const result = await monitorNodeCreatedEvents(chainInfo)
      if (result) {
        console.log('No assertion creation events found on', chainInfo.name)
        alerts.push(result)
      }
    }

    if (alerts.length > 0) {
      const summaryMessage = alerts
        .map(alert => `- ${alert.alertMessage}`)
        .join('\n')

      const alertMessage = `Assertion Creation Alert Summary:\n${summaryMessage}`
      console.error(alertMessage)

      if (options.enableAlerting) {
        await reportAssertionMonitorErrorToSlack({ message: alertMessage })
      }
    } else {
      console.log('No alerts generated for any chains.')
    }
  } catch (e) {
    const errorStr = `Error processing chain data for assertion monitoring: ${e.message}`
    if (options.enableAlerting) {
      reportAssertionMonitorErrorToSlack({ message: errorStr })
    }
    console.error(errorStr)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
