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
  ASSERTION_CONFIRMED_EVENT,
  ASSERTION_CREATED_EVENT,
  NODE_CREATED_EVENT,
  NODE_CONFIRMED_EVENT,
  boldABI,
  rollupABI,
} from './abi'
import { getBlockTimeForChain, getChainFromId } from './chains'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'

const CHUNK_SIZE = 800n
const RETRIES = 5
const RETRY_DELAY_BASE = 100
const VALIDATOR_AFK_BLOCKS = 45818
const MAXIMUM_SEARCH_DAYS = 7
const SAFETY_BUFFER_DAYS = 4
const ASSERTION_CREATION_ALERT_HOURS = 4 // Alert if no assertions in 4 hours with chain activity

const jsonStringifyWithBigInt = (obj: any): string =>
  JSON.stringify(
    obj,
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
    2
  )

class AssertionDataError extends Error {
  constructor(message: string, public readonly rawData?: any) {
    super(message)
    this.name = 'AssertionDataError'
  }
}

type AssertionLogs = {
  createdLogs: any[]
  confirmedLogs: any[]
}

export const getMonitorConfig = (configPath: string = DEFAULT_CONFIG_PATH) => {
  const options = yargs(process.argv.slice(2))
    .options({
      configPath: { type: 'string', default: configPath },
      enableAlerting: { type: 'boolean', default: false },
    })
    .strict()
    .parseSync()

  const config = getConfig(options)

  if (!Array.isArray(config.childChains) || config.childChains.length === 0) {
    throw new Error('Error: Chains not found in the config file.')
  }

  return { config, options }
}

async function getValidatorWhitelistDisabled(
  client: PublicClient,
  rollupAddress: string
): Promise<boolean> {
  const contract = getContract({
    address: rollupAddress as `0x${string}`,
    abi: rollupABI,
    client,
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

async function processChunkedRange<T>(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
  client: PublicClient,
  processChunk: (
    fromBlock: bigint,
    toBlock: bigint,
    client: PublicClient
  ) => Promise<T>
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
    await sleep(1000) // 1 second delay between chunks
  }

  return results
}

export const getBlockRange = async (
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

export const isBoldEnabled = async (
  client: PublicClient,
  rollupAddress: string
): Promise<boolean> => {
  try {
    const contract = getContract({
      address: rollupAddress as `0x${string}`,
      abi: boldABI,
      client,
    })

    const genesisHash = await contract.read.genesisAssertionHash()
    return !!genesisHash
  } catch (error) {
    return false
  }
}

const getLastProcessedBlock = async (
  childChainClient: PublicClient,
  logs: AssertionLogs,
  isBold: boolean
): Promise<bigint> => {
  if (logs.createdLogs.length === 0) {
    throw new AssertionDataError('No assertion logs found')
  }

  // Get the latest assertion
  const latestAssertion = logs.createdLogs[logs.createdLogs.length - 1]

  try {
    let lastProcessedBlockHash: `0x${string}` | undefined

    if (isBold) {
      // For BOLD chains, the block info is in the assertion data
      // assertion[2] is afterState
      // assertion[2][0] is afterState.globalState
      // assertion[2][0].bytes32Vals[0] is the last blockhash processed
      const assertionData = latestAssertion.args.assertion
      if (!assertionData?.[2]?.[0]?.globalStateBytes32Vals?.[0]) {
        throw new AssertionDataError(
          'Incomplete BOLD assertion data structure',
          latestAssertion.args
        )
      }
      lastProcessedBlockHash = assertionData[2][0].globalStateBytes32Vals[0]
    } else {
      // For Classic chains, the block info is in the beforeState
      const assertionData = latestAssertion.args.assertion
      if (!assertionData?.afterState?.globalState?.bytes32Vals?.[0]) {
        throw new AssertionDataError(
          'Incomplete Classic assertion data structure',
          latestAssertion.args
        )
      }
      lastProcessedBlockHash =
        assertionData.afterState.globalState.bytes32Vals[0]
    }

    try {
      const block = await childChainClient.getBlock({
        blockHash: lastProcessedBlockHash,
      })
      console.log(`Last processed child chain block: ${block.number}`)
      return block.number
    } catch (error) {
      throw new AssertionDataError(
        `Failed to get block from hash ${lastProcessedBlockHash}`,
        { error, blockHash: lastProcessedBlockHash }
      )
    }
  } catch (error) {
    if (error instanceof AssertionDataError) {
      throw error
    }
    // If it's some other error accessing the data structure, wrap it
    const safeLog = jsonStringifyWithBigInt(latestAssertion.args)
    throw new AssertionDataError('Error accessing assertion data structure', {
      error,
      rawData: safeLog,
    })
  }
}

/**
 * Checks if there is any transaction activity in the chain
 * between the specified block range.
 */
export const hasChainActivity = async (
  childChainClient: PublicClient,
  fromBlock: bigint,
  toBlock: bigint
): Promise<boolean> => {
  const BATCH_SIZE = 100n
  let currentBlock = fromBlock

  while (currentBlock <= toBlock) {
    const endBlock =
      currentBlock + BATCH_SIZE > toBlock ? toBlock : currentBlock + BATCH_SIZE

    for (let blockNum = currentBlock; blockNum <= endBlock; blockNum++) {
      const block = await childChainClient.getBlock({ blockNumber: blockNum })
      if (block.transactions.length > 0) {
        return true
      }
    }

    currentBlock += BATCH_SIZE + 1n
  }

  return false
}

export type BlockRange = {
  fromBlock: bigint
  toBlock: bigint
}

export const monitorAssertions = async (
  childChainInfo: ChainInfo,
  blockRange?: BlockRange,
  options?: { enableAlerting: boolean }
) => {
  console.log(`\nMonitoring ${childChainInfo.name}...`)

  const parentChain = getChainFromId(childChainInfo.parentChainId)
  const client = createPublicClient({
    chain: parentChain,
    transport: http(childChainInfo.parentRpcUrl),
  })

  const isBold = await isBoldEnabled(client, childChainInfo.ethBridge.rollup)
  console.log(`Chain type: ${isBold ? 'BOLD' : 'Classic'} rollup`)

  const { fromBlock, toBlock } =
    blockRange || (await getBlockRange(client, childChainInfo))
  console.log(
    `Scanning blocks ${fromBlock} to ${toBlock} (${toBlock - fromBlock} blocks)`
  )

  const processChunk = async (
    chunkFromBlock: bigint,
    chunkToBlock: bigint,
    chunkClient: PublicClient
  ): Promise<AssertionLogs> => {
    console.log(`Processing chunk: ${chunkFromBlock} to ${chunkToBlock}`)
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        const createdLogs = await chunkClient.getLogs({
          address: childChainInfo.ethBridge.rollup as `0x${string}`,
          fromBlock: chunkFromBlock,
          toBlock: chunkToBlock,
          event: isBold ? ASSERTION_CREATED_EVENT : NODE_CREATED_EVENT,
        })
        console.log(
          `Found ${createdLogs.length} ${
            isBold ? 'assertions' : 'nodes'
          } created in chunk`
        )

        const confirmedLogs = await chunkClient.getLogs({
          address: childChainInfo.ethBridge.rollup as `0x${string}`,
          fromBlock: chunkFromBlock,
          toBlock: chunkToBlock,
          event: isBold ? ASSERTION_CONFIRMED_EVENT : NODE_CONFIRMED_EVENT,
        })
        console.log(
          `Found ${confirmedLogs.length} ${
            isBold ? 'assertions' : 'nodes'
          } confirmed in chunk`
        )

        if (confirmedLogs.length > 0) {
          console.log('\nAnalyzing confirmed events:')
          for (const log of confirmedLogs) {
            try {
              const eventData = isBold
                ? {
                    blockNumber: log.blockNumber,
                    assertionHash: (log as any).args.assertionHash,
                    blockHash: (log as any).args.blockHash,
                    sendRoot: (log as any).args.sendRoot,
                  }
                : {
                    blockNumber: log.blockNumber,
                    nodeNum: (log as any).args.nodeNum,
                    blockHash: (log as any).args.blockHash,
                    sendRoot: (log as any).args.sendRoot,
                  }
              console.log('Confirmed event:', eventData)
            } catch (error) {
              console.log('Failed to decode confirmed event:', error)
              console.log('Raw log data:', {
                topics: log.topics,
                data: log.data,
                blockNumber: log.blockNumber,
              })
            }
          }
        }

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
        console.log(
          `Retrying in ${RETRY_DELAY_BASE * Math.pow(2, attempt - 1)}ms...`
        )
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

  const allLogs = logsArray.reduce(
    (acc, curr) => {
      if (!curr) return acc
      return {
        createdLogs: [...acc.createdLogs, ...(curr.createdLogs || [])].sort(
          (a, b) => {
            // First sort by block number
            if (a.blockNumber !== b.blockNumber) {
              return Number(a.blockNumber - b.blockNumber)
            }
            // Then by log index within the block
            return Number(a.logIndex - b.logIndex)
          }
        ),
        confirmedLogs: [
          ...acc.confirmedLogs,
          ...(curr.confirmedLogs || []),
        ].sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) {
            return Number(a.blockNumber - b.blockNumber)
          }
          return Number(a.logIndex - b.logIndex)
        }),
      }
    },
    { createdLogs: [], confirmedLogs: [] } as AssertionLogs
  )

  if (allLogs.createdLogs.length > 0 || allLogs.confirmedLogs.length > 0) {
    console.log(
      `Found ${allLogs.createdLogs.length} created and ${allLogs.confirmedLogs.length} confirmed assertions`
    )

    // Show latest confirmation details
    if (allLogs.confirmedLogs.length > 0) {
      const latestConfirmation =
        allLogs.confirmedLogs[allLogs.confirmedLogs.length - 1]
      console.log('\nLatest confirmation details:')
      console.log('- Block:', latestConfirmation.blockNumber)
      console.log(
        '- Assertion Hash:',
        (latestConfirmation as any).args.assertionHash
      )
      console.log('- Block Hash:', (latestConfirmation as any).args.blockHash)
      console.log('- Send Root:', (latestConfirmation as any).args.sendRoot)
    }
  }

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
  const latestSafeBlockNumber = latestSafeBlock.number
  const timestampOfLatestSafeBlock =
    new Date(Number(latestSafeBlock.timestamp) * 1000).toLocaleString() + ' UTC'

  const isLatestSafeBlockWithinRange =
    latestSafeBlockNumber < toBlock && latestSafeBlockNumber > fromBlock

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

  if (allLogs.createdLogs.length === 0) {
    console.log('No creation events found, checking for chain activity...')
    // Check for chain activity in the entire search window
    const hasActivity = await hasChainActivity(
      childChainClient,
      fromBlock,
      latestSafeBlockNumber
    )
    console.log(`Chain activity detected: ${hasActivity}`)

    if (hasActivity) {
      alerts.push(
        `No assertions created on ${
          childChainInfo.name
        } ${durationString} despite chain activity. Latest batch ${
          isLatestSafeBlockWithinRange ? 'was' : 'was not'
        } posted within this duration, at ${timestampOfLatestSafeBlock} (block ${
          latestSafeBlock.number
        }). Validator whitelist is ${
          validatorWhitelistDisabled ? 'disabled' : 'enabled'
        }.`
      )
    }
  } else {
    console.log('Checking time since last event...')
    const latestAssertionBlock = await client.getBlock({
      blockNumber:
        allLogs.createdLogs[allLogs.createdLogs.length - 1].blockNumber,
    })
    const hoursSinceLastAssertion =
      (BigInt(Math.floor(Date.now() / 1000)) - latestAssertionBlock.timestamp) /
      BigInt(3600)
    console.log(`Hours since last assertion: ${hoursSinceLastAssertion}`)

    if (hoursSinceLastAssertion > BigInt(ASSERTION_CREATION_ALERT_HOURS)) {
      console.log(
        `Time since last event (${hoursSinceLastAssertion} hours) exceeds threshold (${ASSERTION_CREATION_ALERT_HOURS} hours), checking for activity...`
      )
      // Check for activity since the last assertion
      const hasActivity = await hasChainActivity(
        childChainClient,
        latestAssertionBlock.number,
        latestSafeBlockNumber
      )
      console.log(`Chain activity detected: ${hasActivity}`)

      if (hasActivity) {
        alerts.push(
          `No assertions created on ${
            childChainInfo.name
          } in the last ${hoursSinceLastAssertion} hours despite chain activity. Last processed parent chain block: ${
            latestAssertionBlock.number
          }, Latest Safe block: ${latestSafeBlockNumber}, Gap: ${
            latestSafeBlockNumber - latestAssertionBlock.number
          } blocks. Validator whitelist is ${
            validatorWhitelistDisabled ? 'disabled' : 'enabled'
          }.`
        )
      }
    }

    if (allLogs.confirmedLogs.length > 0) {
      console.log('Checking confirmation status...')
      const latestConfirmationBlock = await client.getBlock({
        blockNumber:
          allLogs.confirmedLogs[allLogs.confirmedLogs.length - 1].blockNumber,
      })
      const latestParentBlock = await client.getBlockNumber()

      // Get both the parent chain block number and the last processed child chain block
      const latestAssertionBlock =
        allLogs.createdLogs[allLogs.createdLogs.length - 1].blockNumber
      const lastProcessedChildBlock = await getLastProcessedBlock(
        childChainClient,
        allLogs,
        isBold
      ).catch((error: unknown) => {
        if (error instanceof AssertionDataError) {
          const errorMessage = `Assertion data error on ${
            childChainInfo.name
          }: ${error.message}${
            error.rawData
              ? `\nRaw data: ${jsonStringifyWithBigInt(error.rawData)}`
              : ''
          }`
          console.error(errorMessage)
          alerts.push(errorMessage)

          if (options?.enableAlerting) {
            reportAssertionMonitorErrorToSlack({
              message: errorMessage,
            })
          }
        }
        return latestAssertionBlock
      })

      const blocksSinceLastConfirmation =
        latestParentBlock - latestConfirmationBlock.number
      console.log(
        `Blocks since last confirmation: ${blocksSinceLastConfirmation} (confirm period: ${childChainInfo.confirmPeriodBlocks})`
      )

      if (
        allLogs.createdLogs.length > allLogs.confirmedLogs.length &&
        latestParentBlock - latestAssertionBlock >
          BigInt(childChainInfo.confirmPeriodBlocks) &&
        blocksSinceLastConfirmation > BigInt(childChainInfo.confirmPeriodBlocks)
      ) {
        console.log('Confirmation period exceeded, adding alert')
        const alertMessage = `No assertion confirmations on ${
          childChainInfo.name
        } for ${blocksSinceLastConfirmation} blocks (confirm period is ${
          childChainInfo.confirmPeriodBlocks
        } blocks). This is ${
          blocksSinceLastConfirmation -
          BigInt(childChainInfo.confirmPeriodBlocks)
        } blocks over the limit.${
          lastProcessedChildBlock
            ? ` Last processed child chain block: ${lastProcessedChildBlock}.`
            : ''
        } Validator whitelist is ${
          validatorWhitelistDisabled ? 'disabled' : 'enabled'
        }.`
        alerts.push(alertMessage)
      }
    }
  }

  if (alerts.length > 0) {
    console.log(`Generated ${alerts.length} alerts for ${childChainInfo.name}`)
    return {
      chainName: childChainInfo.name,
      alertMessage: alerts.join('\n'),
    }
  }

  console.log(`No issues found for ${childChainInfo.name}`)
  return null
}

export const main = async () => {
  try {
    const { config, options } = getMonitorConfig()
    const alerts: { chainName: string; alertMessage: string }[] = []
    console.log('Starting assertion monitoring...')

    for (const chainInfo of config.childChains) {
      const result = await monitorAssertions(chainInfo)
      if (result) {
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
        console.log('Sending alerts to Slack...')
        await reportAssertionMonitorErrorToSlack({ message: alertMessage })
      }
    } else {
      console.log('\nMonitoring complete - all chains healthy')
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStr = `Error processing chain data for assertion monitoring: ${errorMessage}`
    const { options } = getMonitorConfig()
    if (options.enableAlerting) {
      reportAssertionMonitorErrorToSlack({ message: errorStr })
    }
    console.error(errorStr)
  }
}
