import { ChildNetwork as ChainInfo } from '../utils'
import {
  CHAIN_ACTIVITY_WITHOUT_ASSERTIONS_ALERT,
  CONFIRMATION_DELAY_ALERT,
  CREATION_EVENT_STUCK_ALERT,
  NO_CONFIRMATION_BLOCKS_WITH_CONFIRMATION_EVENTS_ALERT,
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
 */
export const analyzeAssertionEvents = async (
  chainState: ChainState,
  chainInfo: ChainInfo,
  validatorWhitelistDisabled: boolean,
  isBold: boolean = true
): Promise<string[]> => {
  const alerts: string[] = []

  const {
    doesLatestChildCreatedBlockExist,
    doesLatestChildConfirmedBlockExist,
    hasActivityWithoutRecentAssertions,
    noConfirmationsWithCreationEvents,
    noConfirmedBlocksWithConfirmationEvents,
    confirmationDelayExceedsPeriod,
    creationEventStuckInChallengePeriod,
    nonBoldMissingRecentCreation,
  } = generateConditionsForAlerts(chainInfo, chainState, isBold)

  if (validatorWhitelistDisabled) {
    alerts.push(VALIDATOR_WHITELIST_DISABLED_ALERT)
  }

  if (!doesLatestChildCreatedBlockExist) {
    alerts.push(NO_CREATION_EVENTS_ALERT)
  }

  if (!doesLatestChildConfirmedBlockExist) {
    alerts.push(NO_CONFIRMATION_EVENTS_ALERT)
  }

  if (noConfirmedBlocksWithConfirmationEvents) {
    alerts.push(NO_CONFIRMATION_BLOCKS_WITH_CONFIRMATION_EVENTS_ALERT)
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
    childCurrentBlock,
    childLatestCreatedBlock,
    childLatestConfirmedBlock,
    parentCurrentBlock,
    parentBlockAtConfirmation,
    recentCreationEvent,
    recentConfirmationEvent,
  } = chainState

  /**
   * Critical for both chain types as assertions are fundamental to the rollup mechanism
   * No assertions indicates severe validator issues or extreme chain inactivity
   */
  const doesLatestChildCreatedBlockExist = !!childLatestCreatedBlock

  /**
   * For BOLD: Critical for bounded finality guarantees
   * For Classic: Indicates active validation
   *
   * Always compare with current timestamp, not child chain latest block timestamp
   */
  const hasRecentCreationEvents =
    childLatestCreatedBlock &&
    isEventRecent(
      childLatestCreatedBlock.timestamp,
      currentTimestamp / 1000n,
      RECENT_ACTIVITY_SECONDS
    )

  /**
   * Missing confirmations may indicate challenge period in progress or
   * may be normal for low-activity chains where no assertions need confirmation yet
   */
  const doesLatestChildConfirmedBlockExist = !!childLatestConfirmedBlock

  /**
   * Detects transaction processing in child chain not yet asserted in parent chain
   * Normal in small amounts due to batching, concerning in large amounts
   */
  const hasActivityWithoutAssertions =
    childCurrentBlock?.number &&
    childLatestCreatedBlock?.number &&
    childCurrentBlock.number > childLatestCreatedBlock.number

  /**
   * Critical for BOLD due to finality implications
   * Indicates validator issues for both chain types
   */
  const hasActivityWithoutRecentAssertions =
    hasActivityWithoutAssertions && !hasRecentCreationEvents

  /**
   * May indicate active challenges or technical issues with confirmation
   * Could also be normal in low-activity chains where assertions are waiting for challenge period
   */
  const noConfirmationsWithCreationEvents =
    doesLatestChildCreatedBlockExist && !doesLatestChildConfirmedBlockExist

  /**
   * Detects an inconsistent state where confirmation events exist but no confirmed blocks are recorded
   * Indicates a technical issue with confirmation processing or data synchronization
   * This should not occur in normal operation and requires investigation
   */
  const noConfirmedBlocksWithConfirmationEvents =
    recentConfirmationEvent && !doesLatestChildConfirmedBlockExist

  /**
   * Parent chain block gap since last confirmation
   * This is the direct, accurate measure of confirmation delay in terms of parent chain blocks
   */
  const parentBlocksSinceLastConfirmation =
    (parentCurrentBlock?.number &&
      parentBlockAtConfirmation?.number &&
      parentCurrentBlock.number - parentBlockAtConfirmation.number) ??
    0n

  /**
   * Confirmation threshold in parent chain blocks
   * This is the exact, chain-appropriate threshold without any approximation multipliers
   */
  const parentConfirmationThreshold = BigInt(
    chainInfo.confirmPeriodBlocks + VALIDATOR_AFK_BLOCKS
  )

  /**
   * Confirmation delay check using direct parent chain comparison
   * We now assume parent chain data is always available
   */
  const confirmationDelayExceedsPeriod =
    parentBlocksSinceLastConfirmation > parentConfirmationThreshold

  /**
   * Identifies assertions exceeding challenge period (6.4 days) without confirmation
   * Indicates active challenges or confirmation problems
   */
  const creationEventStuckInChallengePeriod =
    isBold &&
    childLatestCreatedBlock &&
    childLatestCreatedBlock?.timestamp &&
    childLatestCreatedBlock.timestamp <
      BigInt(currentTimeSeconds - CHALLENGE_PERIOD_SECONDS)

  /**
   * Only alerts when activity exists without assertions
   * May be normal for low-activity chains, hence contextual consideration required
   */
  const nonBoldMissingRecentCreation =
    !isBold &&
    (!childLatestCreatedBlock ||
      (!hasRecentCreationEvents && hasActivityWithoutAssertions))

  return {
    doesLatestChildCreatedBlockExist,
    doesLatestChildConfirmedBlockExist,
    hasRecentCreationEvents,
    hasActivityWithoutRecentAssertions,
    noConfirmationsWithCreationEvents,
    noConfirmedBlocksWithConfirmationEvents,
    confirmationDelayExceedsPeriod,
    creationEventStuckInChallengePeriod,
    nonBoldMissingRecentCreation,
  }
}
