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
  recentCreation: CreationEvent | null,
  chainState: ChainState,
  chainInfo: ChainInfo
): Promise<string[]> {
  const alerts: string[] = []

  // Check if there are created assertions in the last X hours (shorter period)
  if (recentCreation && chainState.childLastConfirmedBlock) {
    const isRecent = isEventRecent(
      chainState.childLastConfirmedBlock.timestamp,
      chainState.childLatestSafeBlock.timestamp,
      RECENT_CREATION_CHECK_HOURS
    )

    if (isRecent) {
      // Chain functioning, proceed to confirmation check
      console.log('Recent creation events found, chain functioning normally')
      return alerts
    }
  }

  // Check for creation events in the full 7-day range
  if (!recentCreation) {
    // No creation events in last 7 days
    alerts.push(generateNoCreationEventsAlert(chainInfo, MAXIMUM_SEARCH_DAYS))
    return alerts
  }

  // Check if there's new activity since last confirmed block
  if (
    chainState.childLastConfirmedBlock &&
    chainState.childLatestSafeBlock.number &&
    chainState.childLastConfirmedBlock.number &&
    chainState.childLatestSafeBlock.number >
      chainState.childLastConfirmedBlock.number
  ) {
    // Activity exists without new assertions
    alerts.push(
      generateChainActivityWithoutAssertionsAlert(
        chainInfo,
        RECENT_CREATION_CHECK_HOURS,
        chainState.childLastConfirmedBlock.number,
        chainState.childLatestSafeBlock.number
      )
    )
  } else {
    // No new activity
    console.log('No new activity detected on chain')
  }

  return alerts
}

/**
 * Analyzes confirmation events to determine if there are any issues with assertion confirmation
 */
export async function analyzeConfirmationEvents(
  recentConfirmation: ConfirmationEvent | null,
  recentCreation: CreationEvent | null,
  chainState: ChainState,
  chainInfo: ChainInfo
): Promise<string[]> {
  const alerts: string[] = []

  // Check confirmed assertions
  if (recentConfirmation) {
    // System operational
    console.log('Recent confirmation events found, system operational')
    return alerts
  }

  // Compare with created events
  if (!recentCreation) {
    console.log('No activity on chain - system idle')
    return alerts
  }

  // Check if created events are recent
  if (chainState.childLastConfirmedBlock) {
    const isCreationRecent = isEventRecent(
      chainState.childLastConfirmedBlock.timestamp,
      chainState.childLatestSafeBlock.timestamp,
      RECENT_EVENT_HOURS
    )

    if (!isCreationRecent) {
      // Confirmation issues
      alerts.push(
        generateParentConfirmationIssuesAlert(
          chainInfo,
          recentCreation.blockNumber
        )
      )
    } else {
      // Recent activity resumption
      console.log(
        'Recent activity resumption on chain - no immediate confirmation issues'
      )
    }
  }

  return alerts
}

/**
 * Checks for confirmation delays and generates alerts when confirmations exceed the expected period
 */
export async function checkConfirmationDelays(
  childChainInfo: ChainInfo,
  chainState: ChainState,
  recentCreation: CreationEvent | null,
  recentConfirmation: ConfirmationEvent | null,
  validatorWhitelistDisabled: boolean
): Promise<string[]> {
  const alerts: string[] = []

  if (!recentConfirmation || !recentCreation) {
    return alerts
  }

  const blocksSinceLastConfirmation =
    chainState.parentLatestBlockNumber - recentConfirmation.blockNumber

  console.log(
    `Blocks since last confirmation: ${blocksSinceLastConfirmation} (confirm period: ${childChainInfo.confirmPeriodBlocks})`
  )

  const hasUnconfirmedAssertions =
    recentCreation.blockNumber > recentConfirmation.blockNumber
  const assertionAgeExceedsConfirmPeriod =
    chainState.parentLatestBlockNumber - recentCreation.blockNumber >
    BigInt(childChainInfo.confirmPeriodBlocks)
  const confirmationDelayExceedsPeriod =
    blocksSinceLastConfirmation > BigInt(childChainInfo.confirmPeriodBlocks)

  if (
    hasUnconfirmedAssertions ||
    assertionAgeExceedsConfirmPeriod ||
    confirmationDelayExceedsPeriod
  ) {
    console.log('Confirmation delay issue(s) detected:')
    if (hasUnconfirmedAssertions)
      console.log('- Unconfirmed assertions present')
    if (assertionAgeExceedsConfirmPeriod)
      console.log('- Assertion age exceeds confirm period')
    if (confirmationDelayExceedsPeriod)
      console.log('- Confirmation delay exceeds period')

    alerts.push(
      generateConfirmationIssuesAlert(childChainInfo, chainState, {
        hasUnconfirmedAssertions,
        validatorWhitelistDisabled,
        confirmPeriodBlocks: childChainInfo.confirmPeriodBlocks,
      })
    )
  }

  return alerts
}
