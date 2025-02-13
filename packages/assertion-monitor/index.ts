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
import {
  assertionConfirmedEventAbi,
  assertionCreatedEventAbi,
  nodeConfirmedEventAbi,
  nodeCreatedEventAbi,
  rollupABI,
  boldABI,
} from './abi'
import { getBlockTimeForChain, getChainFromId } from './chains'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'

const CHUNK_SIZE = 800n
const RETRIES = 5
const RETRY_DELAY_BASE = 100
const CHUNK_PROCESSING_DELAY = 100
const VALIDATOR_AFK_BLOCKS = 45818
const MAXIMUM_SEARCH_DAYS = 1
const SAFETY_BUFFER_DAYS = 4
const ASSERTION_CREATION_ALERT_HOURS = 4 // Alert if no assertions in 4 hours with chain activity

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

  // Return zero days and blocks if block time is zero to avoid division by zero
  if (blockTime === 0) {
    return {
      days: 0,
      blocks: 0,
    }
  }

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
    await sleep(CHUNK_PROCESSING_DELAY)
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

/**
 * detect BOLD by checking for genesisAssertionHash
 */
const isBoldEnabled = async (
  client: PublicClient,
  rollupAddress: string
): Promise<boolean> => {
  try {
    const contract = getContract({
      address: rollupAddress as `0x${string}`,
      abi: boldABI,
      publicClient: client,
    })

    // Try to read genesisAssertionHash - this will only succeed on BOLD chains
    const genesisHash = await contract.read.genesisAssertionHash()
    const hasBoldFunction = !!genesisHash

    if (hasBoldFunction) {
      console.log(
        'Chain is using BOLD: genesisAssertionHash exists and returned:',
        genesisHash
      )
      return true
    } else {
      console.log(
        'Chain appears to be non-BOLD: genesisAssertionHash not found or returned null'
      )
      return false
    }
  } catch (error) {
    // If we get here, it's likely a non-BOLD chain
    console.log('Chain appears to be non-BOLD:', error.message)
    return false
  }
}

type AssertionLogs = {
  createdLogs: any[]
  confirmedLogs: any[]
}

const getLastProcessedBlock = async (
  client: PublicClient,
  logs: AssertionLogs
): Promise<bigint | null> => {
  if (logs.createdLogs.length === 0) {
    return null
  }

  // Get the latest assertion
  const latestAssertion = logs.createdLogs[logs.createdLogs.length - 1]
  const block = await client.getBlock({
    blockNumber: latestAssertion.blockNumber,
  })

  return block.number
}

/**
 * Checks if there is any transaction activity in the chain
 * between the specified block range.
 */
const hasChainActivity = async (
  childChainClient: PublicClient,
  lastProcessedBlock: bigint | null,
  latestBlock: bigint
): Promise<boolean> => {
  if (!lastProcessedBlock) return false

  // Check if there are any blocks with transactions between lastProcessedBlock and latestBlock
  const BATCH_SIZE = 100n
  let currentBlock = lastProcessedBlock

  while (currentBlock <= latestBlock) {
    const endBlock =
      currentBlock + BATCH_SIZE > latestBlock
        ? latestBlock
        : currentBlock + BATCH_SIZE

    for (let blockNum = currentBlock; blockNum <= endBlock; blockNum++) {
      const block = await childChainClient.getBlock({ blockNumber: blockNum })

      // If block has any transactions, we have activity
      if (block.transactions.length > 0) {
        console.log(
          `Found activity in block ${blockNum}: ${block.transactions.length} transactions`
        )
        return true
      }
    }

    currentBlock += BATCH_SIZE + 1n
  }

  return false
}

const monitorAssertions = async (childChainInfo: ChainInfo) => {
  const parentChain = getChainFromId(childChainInfo.parentChainId)
  const client = createPublicClient({
    chain: parentChain,
    transport: http(childChainInfo.parentRpcUrl),
  })

  console.log('\nMonitoring Configuration:')
  console.log('Chain Name:', childChainInfo.name)
  console.log('Parent Chain ID:', childChainInfo.parentChainId)
  console.log('Rollup Contract:', childChainInfo.ethBridge.rollup)

  // Check if chain is using BOLD
  const isBold = await isBoldEnabled(client, childChainInfo.ethBridge.rollup)
  console.log('Using BOLD:', isBold)
  console.log(
    'Event Type:',
    isBold ? 'AssertionCreated/Confirmed' : 'NodeCreated/Confirmed'
  )

  // Get block range to search
  const { fromBlock, toBlock } = await getBlockRange(client, childChainInfo)
  console.log(
    '\nBlock Range:',
    fromBlock.toString(),
    'to',
    toBlock.toString(),
    `(${(toBlock - fromBlock).toString()} blocks)`
  )

  // Process blocks in chunks
  const processChunk = async (
    chunkFromBlock: bigint,
    chunkToBlock: bigint,
    chunkClient: PublicClient
  ): Promise<AssertionLogs> => {
    console.log(
      '\nFetching logs for blocks',
      chunkFromBlock.toString(),
      'to',
      chunkToBlock.toString(),
      `(${(chunkToBlock - chunkFromBlock + 1n).toString()} blocks)`
    )

    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${RETRIES}`)
        console.log('Event signatures:')
        console.log(
          'Creation:',
          isBold
            ? 'AssertionCreated (["bytes32","bytes32","tuple","bytes32","uint256","bytes32","uint256","address","uint64"])'
            : 'NodeCreated (["uint64","bytes32","bytes32","bytes32"])'
        )
        console.log(
          'Confirmation:',
          isBold
            ? 'AssertionConfirmed (["bytes32","bytes32","bytes32"])'
            : 'NodeConfirmed (["uint64","bytes32","bytes32"])'
        )

        console.log('Fetching creation events...')
        const createdLogs = await chunkClient.getLogs({
          address: childChainInfo.ethBridge.rollup as `0x${string}`,
          fromBlock: chunkFromBlock,
          toBlock: chunkToBlock,
          event: isBold ? assertionCreatedEventAbi : nodeCreatedEventAbi,
        } as any)
        console.log('Found', createdLogs.length, 'creation events')

        console.log('Fetching confirmation events...')
        const confirmedLogs = await chunkClient.getLogs({
          address: childChainInfo.ethBridge.rollup as `0x${string}`,
          fromBlock: chunkFromBlock,
          toBlock: chunkToBlock,
          event: isBold ? assertionConfirmedEventAbi : nodeConfirmedEventAbi,
        } as any)
        console.log('Found', confirmedLogs.length, 'confirmation events')

        return {
          createdLogs,
          confirmedLogs,
        }
      } catch (error) {
        console.error(
          `Error fetching logs (attempt ${attempt}/${RETRIES}):`,
          error
        )
        if (attempt === RETRIES) throw error
        await sleep(RETRY_DELAY_BASE * Math.pow(2, attempt - 1))
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
    processChunk
  )

  console.log('\nAggregating logs from chunks:')
  let totalCreated = 0
  let totalConfirmed = 0
  logsArray.forEach((chunk, i) => {
    if (chunk) {
      const created = chunk.createdLogs?.length || 0
      const confirmed = chunk.confirmedLogs?.length || 0
      totalCreated += created
      totalConfirmed += confirmed
      console.log(`Chunk ${i + 1}: ${created} created, ${confirmed} confirmed`)
    }
  })

  const allLogs = logsArray.reduce(
    (acc, curr) => {
      if (!curr) return acc
      return {
        createdLogs: [...acc.createdLogs, ...(curr.createdLogs || [])],
        confirmedLogs: [...acc.confirmedLogs, ...(curr.confirmedLogs || [])],
      }
    },
    { createdLogs: [], confirmedLogs: [] } as AssertionLogs
  )

  console.log('\nFinal counts:')
  console.log('Total from chunks:', {
    created: totalCreated,
    confirmed: totalConfirmed,
  })
  console.log('Total after reduce:', {
    created: allLogs.createdLogs.length,
    confirmed: allLogs.confirmedLogs.length,
  })

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

  // Get the latest L1 block for proper comparison
  const latestL1Block = await client.getBlockNumber()
  const isLatestSafeBlockWithinRange =
    latestL1Block < toBlock && latestL1Block > fromBlock

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

  const alerts: string[] = []

  // Check for assertion creation issues
  if (allLogs.createdLogs.length === 0) {
    const lastProcessedBlock = await getLastProcessedBlock(
      childChainClient,
      allLogs
    )
    const hasActivity = await hasChainActivity(
      childChainClient,
      lastProcessedBlock,
      latestL1Block
    )

    if (hasActivity) {
      alerts.push(
        `No ${isBold ? 'assertions' : 'nodes'} created on ${
          childChainInfo.name
        } ${durationString} despite chain activity. Latest batch ${
          isLatestSafeBlockWithinRange ? 'was' : 'was not'
        } posted within this duration, at ${timestampOfLatestSafeBlock} (L1 block ${latestL1Block}). Validator whitelist is ${
          validatorWhitelistDisabled ? 'disabled' : 'enabled'
        }.`
      )
    }
  } else {
    // Check if the latest assertion is too old
    const latestAssertionBlock = await client.getBlock({
      blockNumber:
        allLogs.createdLogs[allLogs.createdLogs.length - 1].blockNumber,
    })
    const hoursSinceLastAssertion =
      (BigInt(Math.floor(Date.now() / 1000)) - latestAssertionBlock.timestamp) /
      BigInt(3600)

    if (hoursSinceLastAssertion > BigInt(ASSERTION_CREATION_ALERT_HOURS)) {
      const hasActivity = await hasChainActivity(
        childChainClient,
        latestAssertionBlock.number,
        latestL1Block
      )

      if (hasActivity) {
        alerts.push(
          `No ${isBold ? 'assertions' : 'nodes'} created on ${
            childChainInfo.name
          } in the last ${hoursSinceLastAssertion} hours despite chain activity. Last processed L1 block: ${
            latestAssertionBlock.number
          }, Latest L1 block: ${latestL1Block}, Gap: ${
            latestL1Block - latestAssertionBlock.number
          } blocks. Validator whitelist is ${
            validatorWhitelistDisabled ? 'disabled' : 'enabled'
          }.`
        )
      }
    }

    // Check confirmation rate and timing
    const confirmationRate =
      (allLogs.confirmedLogs.length / allLogs.createdLogs.length) * 100

    // Calculate time since last confirmation
    if (allLogs.confirmedLogs.length > 0) {
      const latestConfirmationBlock = await client.getBlock({
        blockNumber:
          allLogs.confirmedLogs[allLogs.confirmedLogs.length - 1].blockNumber,
      })
      const blocksSinceLastConfirmation =
        latestL1Block - latestConfirmationBlock.number

      if (
        blocksSinceLastConfirmation > BigInt(childChainInfo.confirmPeriodBlocks)
      ) {
        alerts.push(
          `No ${isBold ? 'assertion' : 'node'} confirmations on ${
            childChainInfo.name
          } for ${blocksSinceLastConfirmation} blocks (confirm period is ${
            childChainInfo.confirmPeriodBlocks
          } blocks). This is ${
            blocksSinceLastConfirmation -
            BigInt(childChainInfo.confirmPeriodBlocks)
          } blocks over the limit. Validator whitelist is ${
            validatorWhitelistDisabled ? 'disabled' : 'enabled'
          }.`
        )
      }
    }

    if (confirmationRate < 80) {
      alerts.push(
        `Low ${isBold ? 'assertion' : 'node'} confirmation rate on ${
          childChainInfo.name
        }: ${confirmationRate.toFixed(2)}% (${
          allLogs.confirmedLogs.length
        } confirmations out of ${allLogs.createdLogs.length} ${
          isBold ? 'assertions' : 'nodes'
        }) ${durationString}.`
      )
    }

    console.log(
      `Found ${allLogs.createdLogs.length} ${
        isBold ? 'assertion' : 'node'
      } creation event(s) on ${childChainInfo.name} ${durationString}, with ${
        allLogs.confirmedLogs.length
      } confirmations (${confirmationRate.toFixed(
        2
      )}% confirmation rate). Validator whitelist is ${
        validatorWhitelistDisabled ? 'disabled' : 'enabled'
      }.`
    )
  }

  if (alerts.length > 0) {
    return {
      chainName: childChainInfo.name,
      alertMessage: alerts.join('\n'),
    }
  }

  return null
}

const main = async () => {
  try {
    const alerts: { chainName: string; alertMessage: string }[] = []

    for (const chainInfo of config.childChains) {
      console.log(`Checking for assertion events on ${chainInfo.name}...`)
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