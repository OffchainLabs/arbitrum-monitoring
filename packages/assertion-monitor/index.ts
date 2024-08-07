import * as fs from 'fs'
import * as path from 'path'
import { PublicClient, createPublicClient, http } from 'viem'
import yargs from 'yargs'
import { ChildNetwork as ChainInfo } from '../utils'
import { nodeCreatedEventAbi } from './abi'
import { getChainFromId, getDefaultBlockRange } from './chains'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'

const CHUNK_SIZE = 800n

const options = yargs(process.argv.slice(2))
  .options({
    fromBlock: { type: 'number', default: 0 },
    toBlock: { type: 'number', default: 0 },
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
// Updated processChunkedRange function
async function processChunkedRange<T>(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
  client: PublicClient,
  processChunk: ChunkProcessFunction<T>
): Promise<T[]> {
  const results: T[] = []

  if (fromBlock === toBlock) {
    const result = await processChunk(fromBlock, toBlock, client)
    results.push(result)
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
  const toBlock = BigInt(options.toBlock) || latestBlockNumber

  if (options.fromBlock) {
    return { fromBlock: BigInt(options.fromBlock), toBlock }
  }

  const blockTime = getDefaultBlockRange(
    getChainFromId(childChainInfo.parentChainId)
  )

  const fromBlock = await client.getBlock({
    blockNumber: latestBlockNumber - BigInt(blockTime),
  })

  return { fromBlock: fromBlock.number, toBlock }
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
    console.log(
      `getting logs for chunk from ${chunkFromBlock} to ${chunkToBlock} on ${childChainInfo.name}`
    )
    return client
      .getLogs({
        address: childChainInfo.ethBridge.rollup as `0x${string}`,
        event: nodeCreatedEventAbi,
        fromBlock: chunkFromBlock,
        toBlock: chunkToBlock,
      })
      .catch(console.error)
  }

  const logsArray = await processChunkedRange(
    fromBlock,
    toBlock,
    CHUNK_SIZE,
    client,
    getLogsForChunk
  )

  const logs = logsArray.flat()

  if (!logs || logs.length === 0) {
    return {
      chainName: childChainInfo.name,
      alertMessage: `No assertion events found on ${childChainInfo.name} in the last 7 days.`,
    }
  } else {
    console.log(
      `Found ${logs.length} assertion events on ${childChainInfo.name} in the last 7 days.`
    )
    return null
  }
}

const main = async () => {
  try {
    const alerts: { chainName: string; alertMessage: string }[] = []

    for (const chainInfo of config.childChains) {
      const result = await monitorNodeCreatedEvents(chainInfo)
      if (result) {
        console.log('No assertion events found on', chainInfo.name)
        alerts.push(result)
      }
    }

    if (alerts.length > 0) {
      const summaryMessage = alerts
        .map(alert => `- ${alert.alertMessage}`)
        .join('\n')

      const alertMessage = `Assertion Alert Summary:\n${summaryMessage}`
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
