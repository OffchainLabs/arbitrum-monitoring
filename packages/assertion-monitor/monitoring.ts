import { ChildNetwork as ChainInfo } from '../utils'
import {
  CHAIN_ACTIVITY_WITHOUT_ASSERTIONS_ALERT,
  CONFIRMATION_DELAY_ALERT,
  CREATION_EVENT_STUCK_ALERT,
  NO_CONFIRMATION_EVENTS_ALERT,
  NO_CREATION_EVENTS_ALERT,
  NON_BOLD_NO_RECENT_CREATION_ALERT,
  VALIDATOR_WHITELIST_DISABLED_ALERT,
} from './alerts'
import {
  CHALLENGE_PERIOD_SECONDS,
  RECENT_ACTIVITY_SECONDS,
  VALIDATOR_AFK_BLOCKS,
} from './constants'
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
    latestChildBlock,
    latestChildBlockCreated,
    latestChildBlockConfirmed,
  } = chainState

  /**
   * Creation events existence check
   *
   * Critical for both chain types as assertions are fundamental to the rollup mechanism
   * No assertions indicates severe validator issues or extreme chain inactivity
   */
  const creationEventsExist = !!latestChildBlockCreated

  /**
   * Recent creation events check
   *
   * For BOLD: Critical for bounded finality guarantees
   * For Classic: Indicates active validation
   *
   * Always compare with current timestamp, not child chain latest block timestamp
   */
  const hasRecentCreationEvents =
    latestChildBlockCreated &&
    isEventRecent(
      latestChildBlockCreated.timestamp,
      currentTimestamp / 1000n,
      RECENT_ACTIVITY_SECONDS
    )

  /**
   * Confirmation events existence check
   *
   * Missing confirmations may indicate challenge period in progress or
   * may be normal for low-activity chains where no assertions need confirmation yet
   */
  const confirmationEventsExist = !!latestChildBlockConfirmed

  /**
   * Chain activity without assertions check
   *
   * Detects transaction processing in child chain not yet asserted in parent chain
   * Normal in small amounts due to batching, concerning in large amounts
   */
  const hasActivityWithoutAssertions =
    latestChildBlockCreated &&
    latestChildBlock?.number &&
    latestChildBlockCreated?.number &&
    latestChildBlock.number > latestChildBlockCreated.number

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
   * Could also be normal in low-activity chains where assertions are waiting for challenge period
   */
  const noConfirmationsWithCreationEvents =
    creationEventsExist && !confirmationEventsExist

  /**
   * Confirmation threshold adjustment
   *
   * This attempts to approximate the comparison between parent chain and child chain blocks.
   * A more accurate check would require tracking parent chain blocks for each event.
   *
   * BOLD: closer to 1:1 mapping with additional buffer for validator inactivity
   * Classic: much higher multiplier to account for different block production rates and
   * prevent false positives in low-activity chains
   */
  const confirmationThresholdBlocks = isBold
    ? BigInt(chainInfo.confirmPeriodBlocks + VALIDATOR_AFK_BLOCKS)
    : BigInt(chainInfo.confirmPeriodBlocks + VALIDATOR_AFK_BLOCKS * 10)

  /**
   * Confirmation delay check
   *
   * Detects when gap between latest block and latest confirmed block exceeds threshold
   * This is an approximation as we're comparing child chain blocks against a threshold
   * based on parent chain blocks
   *
   * Note: A more accurate check would be to compare parent chain block numbers, but this
   * would require tracking the parent chain block for each confirmed event
   */
  const confirmationDelayExceedsPeriod =
    latestChildBlock &&
    latestChildBlockConfirmed &&
    latestChildBlock.number &&
    latestChildBlockConfirmed.number &&
    // For BOTH chain types: Only alert when child block to confirmation block gap
    // exceeds the threshold. This is a rough approximation since the threshold
    // is based on parent chain blocks, which have different production rates.
    latestChildBlock.number - latestChildBlockConfirmed.number >
      confirmationThresholdBlocks

  /**
   * BOLD-only check for assertions stuck in challenge period
   *
   * Identifies assertions exceeding challenge period (6.4 days) without confirmation
   * Indicates active challenges or confirmation problems
   */
  const creationEventStuckInChallengePeriod =
    isBold &&
    latestChildBlockCreated &&
    latestChildBlockCreated?.timestamp &&
    latestChildBlockCreated.timestamp <
      BigInt(currentTimeSeconds - CHALLENGE_PERIOD_SECONDS)

  /**
   * Classic chains check for missing recent assertions
   *
   * Only alerts when activity exists without assertions
   * May be normal for low-activity chains, hence contextual consideration required
   */
  const nonBoldMissingRecentCreation =
    !isBold &&
    (!latestChildBlockCreated ||
      (!hasRecentCreationEvents && hasActivityWithoutAssertions))

  return {
    creationEventsExist,
    hasRecentCreationEvents,
    hasActivityWithoutRecentAssertions,
    noConfirmationsWithCreationEvents,
    confirmationDelayExceedsPeriod,
    creationEventStuckInChallengePeriod,
    nonBoldMissingRecentCreation,
  }
}
