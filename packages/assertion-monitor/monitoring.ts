import { ChildNetwork as ChainInfo } from 'utils'
import {
  BOLD_LOW_BASE_STAKE_ALERT,
  CHAIN_ACTIVITY_WITHOUT_ASSERTIONS_ALERT,
  CONFIRMATION_DELAY_ALERT,
  CREATION_EVENT_STUCK_ALERT,
  NO_CONFIRMATION_BLOCKS_WITH_CONFIRMATION_EVENTS_ALERT,
  NO_CONFIRMATION_EVENTS_ALERT,
  NO_CREATION_EVENTS_ALERT,
  VALIDATOR_WHITELIST_DISABLED_ALERT,
} from './alerts'
import {
  CHALLENGE_PERIOD_SECONDS,
  RECENT_ACTIVITY_SECONDS,
  VALIDATOR_AFK_BLOCKS,
} from './constants'
import { getBlockTimeForChain, getChainFromId } from './chains'
import type { ChainState } from './types'
import { isEventRecent } from './utils'

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
    doesLatestChildConfirmedBlockExist,
    hasBatchesWithoutRecentAssertions,
    noConfirmationsWithCreationEvents,
    noConfirmedBlocksWithConfirmationEvents,
    confirmationDelayExceedsPeriod,
    creationEventStuckInChallengePeriod,
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

  if (!doesLatestChildConfirmedBlockExist) {
    alerts.push(NO_CONFIRMATION_EVENTS_ALERT)
  }

  if (noConfirmedBlocksWithConfirmationEvents) {
    alerts.push(NO_CONFIRMATION_BLOCKS_WITH_CONFIRMATION_EVENTS_ALERT)
  }

  if (hasBatchesWithoutRecentAssertions) {
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
    recentConfirmationEvent,
    lastBlockIncludedInBatch,
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
   * Detects batches posted to parent chain but not yet asserted
   * Only alerts when batches exist but no recent assertions cover them
   */
  const childLatestCreatedBlockNumber = childLatestCreatedBlock?.number
  const hasBatchesWithoutAssertionsFromBatchCounter =
    lastBlockIncludedInBatch !== undefined &&
    childLatestCreatedBlockNumber !== undefined &&
    childLatestCreatedBlockNumber !== null &&
    lastBlockIncludedInBatch > childLatestCreatedBlockNumber
  const hasBatchesWithoutAssertionsFromChildProgress =
    lastBlockIncludedInBatch === undefined &&
    childCurrentBlock.number !== null &&
    childLatestCreatedBlockNumber !== undefined &&
    childLatestCreatedBlockNumber !== null &&
    childCurrentBlock.number > childLatestCreatedBlockNumber
  const hasBatchesWithoutAssertions =
    hasBatchesWithoutAssertionsFromBatchCounter ||
    hasBatchesWithoutAssertionsFromChildProgress

  /**
   * Critical for BOLD due to finality implications
   * Indicates validator issues for both chain types
   * Only alerts when batches have been posted but not asserted recently
   */
  const hasBatchesWithoutRecentAssertions =
    hasBatchesWithoutAssertions && !hasRecentCreationEvents

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
    hasRecentCreationEvents,
    hasBatchesWithoutRecentAssertions,
    noConfirmationsWithCreationEvents,
    noConfirmedBlocksWithConfirmationEvents,
    confirmationDelayExceedsPeriod,
    creationEventStuckInChallengePeriod,
    isValidatorWhitelistDisabledOnClassic,
    isBaseStakeBelowThresholdOnBold,
  }
}
