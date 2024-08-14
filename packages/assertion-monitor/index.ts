import Bottleneck from 'bottleneck'
import * as fs from 'fs'
import _ from 'lodash'
import * as path from 'path'
import { PublicClient, createPublicClient, defineChain, http } from 'viem'
import yargs from 'yargs'
import { ChildNetwork as ChainInfo, sleep } from '../utils'
import { nodeCreatedEventAbi } from './abi'
import {
  getBlockTimeForChain,
  getChainFromId,
  getDefaultBlockRange,
} from './chains'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'

const CHUNK_SIZE = 800n
const RETRIES = 3
const minBigInt = (a: bigint, b: bigint): bigint => (a < b ? a : b)

const options = yargs(process.argv.slice(2))
  .options({
    configPath: { type: 'string', default: 'config.json' },
    enableAlerting: { type: 'boolean', default: false },
  })
  .strict()
  .parseSync()

const configFileContent = fs.readFileSync(
  path.join(process.cwd(), options.configPath),
  'utf-8'
)
const config = JSON.parse(configFileContent)

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
  processChunk: ChunkProcessFunction<T>,
  requestsPerSecond: number = 10
): Promise<any> {
  const limiter = new Bottleneck({
    minTime: 1000 / requestsPerSecond,
  })

  const throttledProcessChunk = limiter.wrap(processChunk)

  const totalBlocks = toBlock - fromBlock + 1n
  const numberOfChunks = Number((totalBlocks + chunkSize - 1n) / chunkSize)

  const chunks = _.range(numberOfChunks).map((i: number) => {
    const start = fromBlock + BigInt(i) * chunkSize
    const end = minBigInt(start + chunkSize - 1n, toBlock)
    return { start, end }
  })

  const results = await Promise.all(
    chunks.map(({ start, end }: any) =>
      throttledProcessChunk(start, end, client)
    )
  )

  return results.flat()
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
        console.log('Processing chunks ', chunkFromBlock, chunkToBlock)
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

  const logs = await processChunkedRange(
    fromBlock,
    toBlock,
    CHUNK_SIZE,
    client,
    getLogsForChunk
  )

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
