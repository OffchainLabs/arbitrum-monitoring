import { PublicClient } from 'viem'
import yargs from 'yargs'
import {
  ChildNetwork as ChainInfo,
  DEFAULT_CONFIG_PATH,
  getConfig,
} from '../utils'
import {
  createChildChainClient,
  createParentChainClient,
  processChunkedRange as fetchAssertionLogsForBlockRangeInChunks,
  getValidatorWhitelistDisabled,
  isBoldEnabled,
} from './blockchain'
import { getBlockTimeForChain, getChainFromId } from './chains'
import { logAssertionSummary } from './logs'
import {
  checkChainActivityWhenNoAssertions,
  checkForConfirmationIssues,
  checkForStaleAssertions,
} from './monitoring'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'
import { BlockRange } from './types'
import { sortAndMergeAssertionLogs } from './utils'

const CHUNK_SIZE = 800n
const VALIDATOR_AFK_BLOCKS = 45818
const MAXIMUM_SEARCH_DAYS = 7
const SAFETY_BUFFER_DAYS = 4
const ASSERTION_CREATION_ALERT_HOURS = 4 // Alert if no assertions in 4 hours with chain activity

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

export const checkChainForAssertionIssues = async (
  childChainInfo: ChainInfo,
  blockRange?: BlockRange,
  options?: { enableAlerting: boolean }
) => {
  console.log(`\nMonitoring ${childChainInfo.name}...`)

  const parentChain = getChainFromId(childChainInfo.parentChainId)
  const client = createParentChainClient(
    parentChain,
    childChainInfo.parentRpcUrl
  )

  const isBold = await isBoldEnabled(client, childChainInfo.ethBridge.rollup)
  console.log(`Chain type: ${isBold ? 'BOLD' : 'Classic'} rollup`)

  const { fromBlock, toBlock } =
    blockRange || (await getBlockRange(client, childChainInfo))
  console.log(
    `Scanning blocks ${fromBlock} to ${toBlock} (${toBlock - fromBlock} blocks)`
  )

  const rawAssertionLogs = await fetchAssertionLogsForBlockRangeInChunks(
    fromBlock,
    toBlock,
    CHUNK_SIZE,
    client,
    childChainInfo.ethBridge.rollup,
    isBold
  )

  const sortedAssertionLogs = sortAndMergeAssertionLogs(rawAssertionLogs)

  logAssertionSummary(sortedAssertionLogs)

  const childChainClient = createChildChainClient(childChainInfo)

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

  const assertionCreatedLogsFound = sortedAssertionLogs.createdLogs.length > 0
  if (assertionCreatedLogsFound) {
    const staleAssertionAlerts = await checkForStaleAssertions(
      childChainInfo,
      childChainClient,
      client,
      sortedAssertionLogs,
      latestSafeBlockNumber,
      validatorWhitelistDisabled,
      ASSERTION_CREATION_ALERT_HOURS
    )
    alerts.push(...staleAssertionAlerts)
  } else {
    const missingAssertionAlerts = await checkChainActivityWhenNoAssertions(
      childChainInfo,
      childChainClient,
      fromBlock,
      latestSafeBlockNumber,
      durationString,
      isLatestSafeBlockWithinRange,
      timestampOfLatestSafeBlock,
      validatorWhitelistDisabled
    )
    alerts.push(...missingAssertionAlerts)
  }

  const assertionConfirmedLogsFound =
    sortedAssertionLogs.confirmedLogs.length > 0
  if (assertionConfirmedLogsFound) {
    const confirmationAlerts = await checkForConfirmationIssues(
      childChainInfo,
      childChainClient,
      client,
      sortedAssertionLogs,
      isBold,
      validatorWhitelistDisabled,
      options
    )
    alerts.push(...confirmationAlerts)
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
      const result = await checkChainForAssertionIssues(chainInfo)
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
