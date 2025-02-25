import { PublicClient, createPublicClient, http } from 'viem'
import yargs from 'yargs'
import {
  ChildNetwork as ChainInfo,
  DEFAULT_CONFIG_PATH,
  getConfig,
} from '../utils'
import {
  createChildChainClient,
  fetchChainState,
  getValidatorWhitelistDisabled,
  isBoldEnabled,
} from './blockchain'
import { getBlockTimeForChain, getChainFromId } from './chains'
import {
  MAXIMUM_SEARCH_DAYS,
  SAFETY_BUFFER_DAYS,
  VALIDATOR_AFK_BLOCKS,
} from './constants'
import { analyzeAssertionEvents } from './monitoring'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'
import { BlockRange } from './types'

/**  Retrieves and validates the monitor configuration from the config file. */
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

/** Calculates the appropriate block window for monitoring assertions based on chain characteristics. */
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
    childChainInfo.confirmPeriodBlocks + VALIDATOR_AFK_BLOCKS
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

/**
 * Determines the block range to scan for assertions based on chain configuration.
 * Uses chain-specific parameters to calculate an appropriate range that covers potential confirmation delays.
 */
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

/**
 * Main monitoring function for a single chain's assertion health.
 * Follows a specific flow to analyze chain activity and assertion health.
 */
export const checkChainForAssertionIssues = async (
  childChainInfo: ChainInfo,
  blockRange?: BlockRange,
  options?: { enableAlerting: boolean }
) => {
  console.log(`\nMonitoring ${childChainInfo.name}...`)

  const parentChain = getChainFromId(childChainInfo.parentChainId)
  const parentClient = createPublicClient({
    chain: parentChain,
    transport: http(childChainInfo.parentRpcUrl),
  })

  const isBold = await isBoldEnabled(
    parentClient,
    childChainInfo.ethBridge.rollup
  )
  console.log(`Chain type: ${isBold ? 'BoLD' : 'Classic'} rollup`)

  const { fromBlock, toBlock } =
    blockRange || (await getBlockRange(parentClient, childChainInfo))
  console.log(
    `Scanning blocks ${fromBlock} to ${toBlock} (${toBlock - fromBlock} blocks)`
  )

  const childChainClient = createChildChainClient(childChainInfo)

  const chainState = await fetchChainState({
    childChainClient,
    parentClient,
    childChainInfo,
    isBold,
    fromBlock,
    toBlock,
  })
  // Get validator whitelist status
  const validatorWhitelistDisabled = await getValidatorWhitelistDisabled(
    parentClient,
    childChainInfo.ethBridge.rollup
  )

  const alerts = await analyzeAssertionEvents(
    chainState,
    childChainInfo,
    validatorWhitelistDisabled,
    isBold
  )
  if (alerts.length > 0) {
    console.log(`Generated ${alerts.length} alerts for ${childChainInfo.name}`)
    return `${childChainInfo.name}:\n- ${alerts.join('\n- ')}`
  } else {
    console.log(`No issues found for ${childChainInfo.name}`)
  }
  return
}

/**
 * Entry point for the assertion monitoring system.
 * Reports issues to Slack when alerting is enabled.
 */
export const main = async () => {
  try {
    const { config, options } = getMonitorConfig()
    const alerts: string[] = []
    console.log('Starting assertion monitoring...')

    for (const chainInfo of config.childChains) {
      const result = await checkChainForAssertionIssues(chainInfo)
      if (result) {
        alerts.push(result)
      }
    }

    if (alerts.length > 0) {
      const alertMessage = `Assertion Monitor Alert Summary:\n\n${alerts}`
      console.log(alertMessage)

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
