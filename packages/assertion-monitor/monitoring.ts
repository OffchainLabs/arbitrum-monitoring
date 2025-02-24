import { ChildNetwork as ChainInfo } from '../utils'
import {
  generateChainActivityWithoutAssertionsAlert,
  generateConfirmationIssuesAlert,
  generateNoCreationEventsAlert,
  generateParentConfirmationIssuesAlert,
} from './alerts'
import type { ChainState, ConfirmationEvent, CreationEvent } from './types'

/** Maximum number of days to look back when scanning for assertions */
const MAXIMUM_SEARCH_DAYS = 7

/** Number of hours to check for recent creation events */
const RECENT_CREATION_CHECK_HOURS = 4

/** Number of hours to consider an event "recent" for confirmation checks */
const RECENT_EVENT_HOURS = 24

/** Convert hours to seconds for timestamp comparison */
const hoursToSeconds = (hours: number) => hours * 60 * 60

/**
 * Checks if an event is within a recent time window
 */
function isEventRecent(
  eventTimestamp: bigint,
  currentTimestamp: bigint,
  hoursThreshold: number
): boolean {
  const timeSinceEvent = Number(currentTimestamp - eventTimestamp)
  return timeSinceEvent <= hoursToSeconds(hoursThreshold)
}

/**
 * Analyzes creation events to determine if there are any issues with assertion creation
 */
export async function analyzeCreationEvents(
  chainState: ChainState,
  chainInfo: ChainInfo
): Promise<string[]> {
  const alerts: string[] = []

  // Check for creation events in the full 7-day range
  if (!chainState.latestCreationBlock) {
    // No creation events in last 7 days
    alerts.push(generateNoCreationEventsAlert(chainInfo, MAXIMUM_SEARCH_DAYS))
    return alerts
  }

  // Check if there are created assertions in the last X hours
  if (chainState.latestCreationBlock && chainState.childLatestBlock) {
    const isRecent = isEventRecent(
      chainState.latestCreationBlock.timestamp,
      chainState.childLatestBlock.timestamp,
      RECENT_CREATION_CHECK_HOURS
    )

    if (isRecent) {
      // Chain functioning, proceed to confirmation check
      console.log('Recent creation events found, chain functioning normally')
      return alerts
    }
  }

  // Check if there's new activity since last confirmed block
  if (
    chainState.latestConfirmedBlock &&
    chainState.childLatestBlock.number &&
    chainState.latestConfirmedBlock.number &&
    chainState.childLatestBlock.number > chainState.latestConfirmedBlock.number
  ) {
    // Activity exists without new assertions
    const activityAlerts = generateChainActivityWithoutAssertionsAlert(
      chainInfo,
      RECENT_CREATION_CHECK_HOURS,
      chainState.latestConfirmedBlock.number,
      chainState.childLatestBlock.number
    )
    alerts.push(activityAlerts)
  } else {
    // No new activity
    console.log('No new activity detected on chain')
  }

  return alerts
}

/**
 * Analyzes confirmation events to determine if there are any issues with assertion confirmation.
 */
export async function analyzeConfirmationEvents(
  chainState: ChainState,
  chainInfo: ChainInfo
): Promise<string[]> {
  const alerts: string[] = []

  // Compare with created events
  if (chainState.latestConfirmedBlock && !chainState.latestCreationBlock) {
    console.log('No activity on chain - system idle')
    return alerts
  }

  /**
   * We check recent creation events here because:
   * - If there are no creations, no confirmations are expected (chain is idle)
   * - If there are creations but no confirmations, we have a confirmation issue
   * - This prevents false alerts when the chain has no activity
   */
  if (chainState.latestConfirmedBlock) {
    const isCreationRecent = isEventRecent(
      chainState.latestConfirmedBlock.timestamp,
      chainState.childLatestBlock.timestamp,
      RECENT_EVENT_HOURS
    )

    if (!isCreationRecent) {
      // Confirmation issues
      alerts.push(
        generateParentConfirmationIssuesAlert(
          chainInfo,
          chainState.childLatestBlock.number!
        )
      )
    } else {
      // Recent activity resumption
      console.log(
        'Recent activity resumption on chain - no immediate confirmation issues'
      )
    }
  }

  // Check confirmed assertions
  if (chainState.latestConfirmedBlock) {
    // System operational
    console.log('Recent confirmation events found, system operational')
    return alerts
  }

  return alerts
}

/**
 * Checks for confirmation delays and generates alerts when confirmations exceed the expected period
 */
export async function checkConfirmationDelays(
  childChainInfo: ChainInfo,
  chainState: ChainState,
  validatorWhitelistDisabled: boolean
): Promise<string[]> {
  const alerts: string[] = []

  if (
    !chainState.latestConfirmedBlock ||
    !chainState.latestCreationBlock ||
    !chainState.latestConfirmedBlock.number ||
    !chainState.latestCreationBlock.number
  ) {
    return alerts
  }

  const blocksSinceLastConfirmation =
    chainState.childLatestBlock.number! -
      chainState.latestConfirmedBlock.number!

  console.log(
    `Blocks since last confirmation: ${blocksSinceLastConfirmation} (confirm period: ${childChainInfo.confirmPeriodBlocks})`
  )

  const confirmationDelayExceedsPeriod =
    blocksSinceLastConfirmation > BigInt(childChainInfo.confirmPeriodBlocks)

  if (confirmationDelayExceedsPeriod || blocksSinceLastConfirmation <= 0n) {
    console.log('Confirmation delay exceeds period')

    alerts.push(
      generateConfirmationIssuesAlert(childChainInfo, chainState, {
        validatorWhitelistDisabled,
        confirmPeriodBlocks: childChainInfo.confirmPeriodBlocks,
      })
    )
  }

  return alerts
}
