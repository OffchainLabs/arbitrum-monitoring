import { ChildNetwork as ChainInfo } from 'utils'
import {
  BOLD_LOW_BASE_STAKE_ALERT,
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
import {
  getBlockTimeForChain,
  getChainFromId,
  getRollupBlockTimeForChain,
} from './chains'
import type { ChainState } from './types'

/**
 * Formats duration in a human-readable format
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  } else if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`
  } else if (seconds < 86400) {
    return `${Math.round(seconds / 3600)}h`
  } else {
    const days = Math.floor(seconds / 86400)
    const hours = Math.round((seconds % 86400) / 3600)
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  }
}

/**
 * How long child blocks may stay unasserted before alerting. Chains that are
 * configured to assert less often get a proportionally longer threshold.
 */
function getAssertionBacklogThresholdSeconds(chainInfo: ChainInfo): number {
  return Math.max(
    RECENT_ACTIVITY_SECONDS,
    2 * (chainInfo.assertionIntervalSeconds ?? 0)
  )
}

/**
 * Creates a detailed alert message when no creation events are found in the search window
 */
function createNoCreationEventsAlert(
  chainState: ChainState,
  chainInfo: ChainInfo
): string {
  if (
    chainState.searchFromBlock &&
    chainState.searchToBlock &&
    chainState.parentCurrentBlock
  ) {
    const parentChain = getChainFromId(chainInfo.parentChainId)
    const blockTime = getBlockTimeForChain(parentChain)

    if (blockTime > 0) {
      const blocksSearched =
        chainState.searchToBlock - chainState.searchFromBlock
      const durationSeconds = Number(blocksSearched) * blockTime
      const duration = formatDuration(durationSeconds)

      // Check if chain is active (producing blocks recently)
      // Use the same search window duration to check for activity
      const currentTimeSeconds = Math.floor(Date.now() / 1000)
      const hasChainActivity =
        !!(
          chainState.childCurrentBlock && chainState.childCurrentBlock.timestamp
        ) &&
        // Chain is active if child chain block is recent (within search window)
        currentTimeSeconds - Number(chainState.childCurrentBlock.timestamp) <
          durationSeconds

      const activityFlag = hasChainActivity
        ? 'Chain is active'
        : 'Chain is inactive'

      return `${activityFlag}, and No assertion creation events found in ~${duration} search window (blocks ${chainState.searchFromBlock} - ${chainState.searchToBlock}).`
    }
  }

  return NO_CREATION_EVENTS_ALERT
}

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
  isBold: boolean = true
): Promise<string[]> => {
  const alerts: string[] = []

  const {
    doesLatestChildCreatedBlockExist,
    hasActivityWithoutRecentAssertions,
    assertionBacklogSeconds,
    assertionBacklogThresholdSeconds,
    noConfirmationsWithCreationEvents,
    noConfirmedBlocksWithConfirmationEvents,
    confirmationDelayExceedsPeriod,
    creationEventStuckInChallengePeriod,
    nonBoldMissingRecentCreation,
    isValidatorWhitelistDisabledOnClassic,
    isBaseStakeBelowThresholdOnBold,
  } = generateConditionsForAlerts(chainInfo, chainState, isBold)

  if (isValidatorWhitelistDisabledOnClassic) {
    alerts.push(VALIDATOR_WHITELIST_DISABLED_ALERT)
  }

  if (isBaseStakeBelowThresholdOnBold) {
    alerts.push(BOLD_LOW_BASE_STAKE_ALERT)
  }

  if (!doesLatestChildCreatedBlockExist) {
    alerts.push(createNoCreationEventsAlert(chainState, chainInfo))
  }

  if (noConfirmedBlocksWithConfirmationEvents) {
    alerts.push(NO_CONFIRMATION_BLOCKS_WITH_CONFIRMATION_EVENTS_ALERT)
  }

  if (hasActivityWithoutRecentAssertions) {
    alerts.push(
      `${CHAIN_ACTIVITY_WITHOUT_ASSERTIONS_ALERT} (oldest unasserted block is ${formatDuration(
        assertionBacklogSeconds
      )} old, threshold ${formatDuration(assertionBacklogThresholdSeconds)})`
    )
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
    childFirstUnassertedBlock,
    parentBlockAtOldestCreation,
    recentConfirmationEvent,
  } = chainState

  const rollupBlockTime = getRollupBlockTimeForChain(
    getChainFromId(chainInfo.parentChainId)
  )
  const confirmPeriodSeconds = chainInfo.confirmPeriodBlocks * rollupBlockTime
  const assertionBacklogThresholdSeconds =
    getAssertionBacklogThresholdSeconds(chainInfo)

  /**
   * Critical for both chain types as assertions are fundamental to the rollup mechanism
   * No assertions indicates severe validator issues or extreme chain inactivity
   */
  const doesLatestChildCreatedBlockExist = !!childLatestCreatedBlock

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
   * Age of the oldest child block not yet covered by an assertion. Measured on
   * the unasserted block rather than the asserted one, so sparse chains whose
   * latest asserted block is naturally old do not alert.
   */
  const assertionBacklogSeconds = childFirstUnassertedBlock
    ? currentTimeSeconds - Number(childFirstUnassertedBlock.timestamp)
    : 0

  /**
   * Critical for BOLD due to finality implications
   * Indicates validator issues for both chain types
   */
  const hasActivityWithoutRecentAssertions =
    !!hasActivityWithoutAssertions &&
    assertionBacklogSeconds > assertionBacklogThresholdSeconds

  /**
   * Only alerts once the oldest assertion in the window should already have
   * been confirmed, so a freshly deployed or migrated rollup does not alert
   * while its first assertions are still inside the confirm period.
   */
  const noConfirmationsWithCreationEvents =
    doesLatestChildCreatedBlockExist &&
    !recentConfirmationEvent &&
    !!parentBlockAtOldestCreation &&
    currentTimeSeconds - Number(parentBlockAtOldestCreation.timestamp) >
      confirmPeriodSeconds + assertionBacklogThresholdSeconds

  /**
   * Detects an inconsistent state where confirmation events exist but no confirmed blocks are recorded
   * Indicates a technical issue with confirmation processing or data synchronization
   * This should not occur in normal operation and requires investigation
   */
  const noConfirmedBlocksWithConfirmationEvents =
    recentConfirmationEvent && !doesLatestChildConfirmedBlockExist

  /**
   * Time since the last confirmation, from parent chain block timestamps
   */
  const secondsSinceLastConfirmation =
    parentCurrentBlock && parentBlockAtConfirmation
      ? Number(
          parentCurrentBlock.timestamp - parentBlockAtConfirmation.timestamp
        )
      : 0

  /**
   * Confirmation threshold in seconds. Compared in time because confirm
   * periods tick in L1 blocks even when the parent chain is an Arbitrum chain.
   */
  const confirmationThresholdSeconds =
    (chainInfo.confirmPeriodBlocks + VALIDATOR_AFK_BLOCKS) * rollupBlockTime

  const confirmationDelayExceedsPeriod =
    secondsSinceLastConfirmation > confirmationThresholdSeconds

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
    !isBold && (!childLatestCreatedBlock || hasActivityWithoutRecentAssertions)

  /**
   * Whether a Classic chain's validator whitelist is disabled, allowing
   * unauthorized validators to post assertions.
   */
  const isValidatorWhitelistDisabledOnClassic =
    !isBold && chainState.isValidatorWhitelistDisabled

  /**
   * Whether a BoLD chain's base stake is below threshold, indicating restricted
   * validator participation in dispute resolution.
   */
  const isBaseStakeBelowThresholdOnBold =
    isBold &&
    chainState.isBaseStakeBelowThreshold &&
    chainState.isValidatorWhitelistDisabled

  return {
    doesLatestChildCreatedBlockExist,
    doesLatestChildConfirmedBlockExist,
    hasActivityWithoutRecentAssertions,
    assertionBacklogSeconds,
    assertionBacklogThresholdSeconds,
    noConfirmationsWithCreationEvents,
    noConfirmedBlocksWithConfirmationEvents,
    confirmationDelayExceedsPeriod,
    creationEventStuckInChallengePeriod,
    nonBoldMissingRecentCreation,
    isValidatorWhitelistDisabledOnClassic,
    isBaseStakeBelowThresholdOnBold,
  }
}
