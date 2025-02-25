import { ChildNetwork as ChainInfo } from '../utils'
import {
  CHAIN_ACTIVITY_WITHOUT_ASSERTIONS_ALERT,
  CONFIRMATION_DELAY_ALERT,
  CREATION_EVENT_STUCK_ALERT,
  NO_CONFIRMATION_EVENTS_ALERT,
  NO_CREATION_EVENTS_ALERT,
  NON_BOLD_NO_RECENT_CREATION_ALERT,
  PARENT_CHAIN_AHEAD_ALERT,
  VALIDATOR_WHITELIST_DISABLED_ALERT,
} from './alerts'
import { CHALLENGE_PERIOD_SECONDS, RECENT_ACTIVITY_SECONDS } from './constants'
import type { ChainState } from './types'
import { isEventRecent } from './utils'

/**
 * Analyzes chain state to detect assertion and confirmation issues
 *
 * Evaluates BOLD chains for:
 * - Challenge/confirmation system health
 * - Validator activity and challenge detection
 * - Bounded finality guarantee issues
 * - Whitelist security concerns
 *
 * Evaluates Classic chains with adjusted thresholds for:
 * - Basic validator activity
 * - Confirmation patterns
 *
 * @throws If chainState contains invalid data
 */
export const analyzeAssertionEvents = async (
  chainState: ChainState,
  chainInfo: ChainInfo,
  validatorWhitelistDisabled: boolean,
  isBold: boolean = true
): Promise<string[]> => {
  const alerts: string[] = []

  const {
    creationEventsExist,
    hasActivityWithoutRecentAssertions,
    noConfirmationsWithCreationEvents,
    confirmationDelayExceedsPeriod,
    creationEventStuckInChallengePeriod,
    parentChainAheadOfLatestCreation,
    nonBoldMissingRecentCreation,
  } = generateConditionsForAlerts(chainInfo, chainState, isBold)

  if (validatorWhitelistDisabled) {
    alerts.push(VALIDATOR_WHITELIST_DISABLED_ALERT)
  }

  if (!creationEventsExist) {
    alerts.push(NO_CREATION_EVENTS_ALERT)
  }

  if (hasActivityWithoutRecentAssertions) {
    alerts.push(CHAIN_ACTIVITY_WITHOUT_ASSERTIONS_ALERT)
  }

  if (noConfirmationsWithCreationEvents) {
    alerts.push(NO_CONFIRMATION_EVENTS_ALERT)
  }

  if (confirmationDelayExceedsPeriod) {
    alerts.push(CONFIRMATION_DELAY_ALERT)
  }

  if (creationEventStuckInChallengePeriod) {
    alerts.push(CREATION_EVENT_STUCK_ALERT)
  }

  if (parentChainAheadOfLatestCreation) {
    alerts.push(PARENT_CHAIN_AHEAD_ALERT)
  }

  if (nonBoldMissingRecentCreation) {
    alerts.push(NON_BOLD_NO_RECENT_CREATION_ALERT)
  }

  if (alerts.length > 0) {
    console.log(alerts)
  }

  return alerts
}

/**
 * Generates boolean conditions for chain health alerts
 *
 * @throws If essential chain state data is missing
 */
export const generateConditionsForAlerts = (
  chainInfo: ChainInfo,
  chainState: ChainState,
  isBold: boolean
) => {
  const currentTimestamp = BigInt(Date.now())
  const currentTimeSeconds = Number(currentTimestamp / 1000n)

  const {
    parentLatestBlock,
    childLatestBlock,
    latestCreationBlock,
    latestConfirmedBlock,
  } = chainState

  /**
   * Creation events existence check
   *
   * Critical for both chain types as assertions are fundamental to the rollup mechanism
   * No assertions indicates severe validator issues or extreme chain inactivity
   */
  const creationEventsExist = !!latestCreationBlock

  /**
   * Recent creation events check
   *
   * For BOLD: Critical for bounded finality guarantees
   * For Classic: Indicates active validation
   */
  const hasRecentCreationEvents =
    latestCreationBlock &&
    isEventRecent(
      latestCreationBlock.timestamp,
      currentTimestamp / 1000n,
      RECENT_ACTIVITY_SECONDS
    )

  /**
   * Confirmation events existence check
   *
   * Missing confirmations may indicate challenge period in progress,
   * active disputes, or confirmation system issues
   */
  const confirmationEventsExist = !!latestConfirmedBlock

  /**
   * Chain activity without assertions check
   *
   * Detects transaction processing in child chain not yet asserted in parent chain
   * Normal in small amounts due to batching, concerning in large amounts
   */
  const hasActivityWithoutAssertions =
    latestCreationBlock &&
    childLatestBlock?.number &&
    latestCreationBlock?.number &&
    childLatestBlock.number > latestCreationBlock.number

  /**
   * Compound check for active chain with no recent assertions
   *
   * Critical for BOLD due to finality implications
   * Indicates validator issues for both chain types
   */
  const hasActivityWithoutRecentAssertions =
    hasActivityWithoutAssertions && !hasRecentCreationEvents

  /**
   * Check for assertions without confirmations
   *
   * May indicate active challenges or technical issues with confirmation
   */
  const noConfirmationsWithCreationEvents =
    creationEventsExist && !confirmationEventsExist

  /**
   * Confirmation threshold calculation
   *
   * BOLD: Exact confirmPeriodBlocks for precise finality guarantee
   * Classic: 20x multiplier based on empirical observations to prevent false positives
   * while still detecting severe issues
   */
  const confirmationThresholdBlocks = isBold
    ? BigInt(chainInfo.confirmPeriodBlocks)
    : BigInt(chainInfo.confirmPeriodBlocks) * 20n

  /**
   * Confirmation delay check
   *
   * Detects when gap between creation and confirmation exceeds threshold
   * May indicate challenges, disputes, or confirmation issues
   */
  const confirmationDelayExceedsPeriod =
    latestCreationBlock &&
    latestConfirmedBlock &&
    latestCreationBlock?.number &&
    latestConfirmedBlock?.number &&
    latestCreationBlock.number - latestConfirmedBlock.number >
      confirmationThresholdBlocks

  /**
   * BOLD-only check for assertions stuck in challenge period
   *
   * Identifies assertions exceeding challenge period (6.4 days) without confirmation
   * Indicates active challenges or confirmation problems
   */
  const creationEventStuckInChallengePeriod =
    isBold &&
    latestCreationBlock &&
    latestCreationBlock?.timestamp &&
    latestCreationBlock.timestamp <
      BigInt(currentTimeSeconds - CHALLENGE_PERIOD_SECONDS)

  /**
   * BOLD-only check for parent chain ahead of latest assertion
   *
   * Only meaningful for BOLD chains due to aligned block numbering
   * May indicate validators struggling to keep up with parent chain
   */
  const parentChainAheadOfLatestCreation =
    isBold &&
    latestCreationBlock &&
    parentLatestBlock &&
    latestCreationBlock?.number &&
    parentLatestBlock?.number &&
    parentLatestBlock.number > latestCreationBlock.number + 10n

  /**
   * Classic chains check for missing recent assertions
   *
   * Only alerts when activity exists without assertions
   * May be normal for low-activity chains, hence contextual consideration required
   */
  const nonBoldMissingRecentCreation =
    !isBold &&
    (!latestCreationBlock ||
      (!hasRecentCreationEvents && hasActivityWithoutAssertions))

  return {
    creationEventsExist,
    hasRecentCreationEvents,
    hasActivityWithoutRecentAssertions,
    noConfirmationsWithCreationEvents,
    confirmationDelayExceedsPeriod,
    creationEventStuckInChallengePeriod,
    parentChainAheadOfLatestCreation,
    nonBoldMissingRecentCreation,
  }
}
