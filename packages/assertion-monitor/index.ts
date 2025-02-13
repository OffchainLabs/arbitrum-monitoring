import {
  PublicClient,
  createPublicClient,
  defineChain,
  getContract,
  http,
} from 'viem'
import yargs from 'yargs'
import {
  ChildNetwork as ChainInfo,
  DEFAULT_CONFIG_PATH,
  getConfig,
  sleep,
} from '../utils'
import { assertionCreatedEventAbi, assertionConfirmedEventAbi } from './abi'
import { getBlockTimeForChain, getChainFromId } from './chains'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'

const CHUNK_SIZE = 800n
const RETRIES = 3
const VALIDATOR_AFK_BLOCKS = 45818
const MAXIMUM_SEARCH_DAYS = 7
const SAFETY_BUFFER_DAYS = 4

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

const rollupABI = [
  {
    inputs: [],
    name: 'validatorWhitelistDisabled',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

async function getValidatorWhitelistDisabled(
  client: PublicClient,
  rollupAddress: string
): Promise<boolean> {
  const contract = getContract({
    address: rollupAddress as `0x${string}`,
    abi: rollupABI,
    publicClient: client,
  })

  return contract.read.validatorWhitelistDisabled()
}

function calculateSearchWindow(
  childChainInfo: ChainInfo,
  parentChain: ReturnType<typeof getChainFromId>
): { days: number; blocks: number } {
  const blockTime = getBlockTimeForChain(parentChain)
  const initialBlocksToSearch =
    childChainInfo.confirmPeriodBlocks * VALIDATOR_AFK_BLOCKS
  const timespan = blockTime * initialBlocksToSearch

  const blocksInDays = timespan / (60 * 60 * 24)
  const blocksInDaysMinusSafety = Math.max(blocksInDays - SAFETY_BUFFER_DAYS, 0)
  const daysAdjustedForMax = Math.min(
    Math.ceil(blocksInDaysMinusSafety),
    MAXIMUM_SEARCH_DAYS
  )

  // Calculate the maximum number of blocks for the maximum search days
  const maxSearchableBlocks = Math.floor(
    (MAXIMUM_SEARCH_DAYS * 24 * 60 * 60) / blockTime
  )

  // Adjust blocks to the maximum of 7 days
  const adjustedBlocks = Math.min(initialBlocksToSearch, maxSearchableBlocks)

  return {
    days: daysAdjustedForMax,
    blocks: adjustedBlocks,
  }
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
  const parentChain = getChainFromId(childChainInfo.parentChainId)
  const { blocks: blockRange } = calculateSearchWindow(
    childChainInfo,
    parentChain
  )

  const fromBlock = await client.getBlock({
    blockNumber: latestBlockNumber - BigInt(blockRange),
  })

  return { fromBlock: fromBlock.number, toBlock: latestBlockNumber }
}

const monitorAssertions = async (childChainInfo: ChainInfo) => {
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
        // Get both AssertionCreated and AssertionConfirmed events
        const [createdLogs, confirmedLogs] = await Promise.all([
          client.getLogs({
            address: childChainInfo.ethBridge.rollup as `0x${string}`,
            event: assertionCreatedEventAbi,
            fromBlock: chunkFromBlock,
            toBlock: chunkToBlock,
          }),
          client.getLogs({
            address: childChainInfo.ethBridge.rollup as `0x${string}`,
            event: assertionConfirmedEventAbi,
            fromBlock: chunkFromBlock,
            toBlock: chunkToBlock,
          }),
        ])

        return {
          createdLogs,
          confirmedLogs,
        }
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
    return {
      createdLogs: [],
      confirmedLogs: [],
    }
  }

  const logsArray = await processChunkedRange(
    fromBlock,
    toBlock,
    CHUNK_SIZE,
    client,
    getLogsForChunk
  )

  const allLogs = logsArray.reduce(
    (acc, curr) => {
      return {
        createdLogs: [...acc.createdLogs, ...(curr?.createdLogs || [])],
        confirmedLogs: [...acc.confirmedLogs, ...(curr?.confirmedLogs || [])],
      }
    },
    { createdLogs: [], confirmedLogs: [] }
  )

  const childChain = defineChain({
    id: childChainInfo.chainID,
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

  const validatorWhitelistDisabled = await getValidatorWhitelistDisabled(
    client,
    childChainInfo.ethBridge.rollup
  )

  const { days: durationInDays } = calculateSearchWindow(
    childChainInfo,
    parentChain
  )
  const durationString = `in the last ${
    durationInDays === 1 ? ' day' : durationInDays + ' days'
  }`

  if (allLogs.createdLogs.length === 0) {
    return {
      chainName: childChainInfo.name,
      alertMessage: `No assertion creation events found on ${
        childChainInfo.name
      } ${durationString}. Latest batch ${
        isLatestSafeBlockWithinRange ? 'was' : 'was not'
      } posted within this duration, at ${timestampOfLatestSafeBlock} (block ${
        latestSafeBlock.number
      }). Validator whitelist is ${
        validatorWhitelistDisabled ? 'disabled' : 'enabled'
      }.`,
    }
  } else {
    // Calculate confirmation rate
    const confirmationRate =
      (allLogs.confirmedLogs.length / allLogs.createdLogs.length) * 100

    console.log(
      `Found ${
        allLogs.createdLogs.length
      } assertion creation event(s) on ${childChainInfo.name} ${durationString}, with ${
        allLogs.confirmedLogs.length
      } confirmations (${confirmationRate.toFixed(
        2
      )}% confirmation rate). Validator whitelist is ${
        validatorWhitelistDisabled ? 'disabled' : 'enabled'
      }.`
    )

    // Alert if confirmation rate is too low (e.g., below 80%)
    if (confirmationRate < 80) {
      return {
        chainName: childChainInfo.name,
        alertMessage: `Low assertion confirmation rate on ${
          childChainInfo.name
        }: ${confirmationRate.toFixed(2)}% (${
          allLogs.confirmedLogs.length
        } confirmations out of ${
          allLogs.createdLogs.length
        } assertions) ${durationString}.`,
      }
    }

    return null
  }
}

const main = async () => {
  try {
    const alerts: { chainName: string; alertMessage: string }[] = []

    for (const chainInfo of config.childChains) {
      console.log(
        `Checking for assertion events on ${chainInfo.name}...`
      )
      const result = await monitorAssertions(chainInfo)
      if (result) {
        console.log('Alert generated for', chainInfo.name)
        alerts.push(result)
      }
    }

    if (alerts.length > 0) {
      const summaryMessage = alerts
        .map(alert => `- ${alert.alertMessage}`)
        .join('\n')

      const alertMessage = `Assertion Monitor Alert Summary:\n${summaryMessage}`
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
