import { ChildNetwork as ChainInfo } from '../utils'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'
import { jsonStringifyWithBigInt } from './utils'
import { AssertionDataError } from './errors'
import { Block } from 'viem'
import { ChainState } from './types'
/**
 * Generates an alert for confirmation-related issues
 */
export function generateConfirmationIssuesAlert(
  chainInfo: ChainInfo,
  chainState: ChainState,
  {
    hasUnconfirmedAssertions,
    validatorWhitelistDisabled,
    confirmPeriodBlocks,
  }: {
    hasUnconfirmedAssertions: boolean
    validatorWhitelistDisabled: boolean
    confirmPeriodBlocks: number
  }
): string {
  const issues: string[] = []

  if (hasUnconfirmedAssertions) {
    issues.push('There are assertions waiting to be confirmed')
  }

  const blocksSinceLastConfirmation =
    chainState.parentLatestBlockNumber -
    chainState.childLastConfirmedBlock?.number!
  const assertionAgeExceedsConfirmPeriod =
    blocksSinceLastConfirmation > BigInt(confirmPeriodBlocks)
  const confirmationDelayExceedsPeriod =
    blocksSinceLastConfirmation > BigInt(confirmPeriodBlocks)

  if (assertionAgeExceedsConfirmPeriod) {
    issues.push(
      `The oldest unconfirmed assertion has exceeded the ${confirmPeriodBlocks} block confirmation period`
    )
  }

  if (confirmationDelayExceedsPeriod) {
    const confirmPeriodExceededBy =
      blocksSinceLastConfirmation - BigInt(confirmPeriodBlocks)
    issues.push(
      `No confirmations for ${blocksSinceLastConfirmation} blocks (${confirmPeriodExceededBy} blocks over the ${confirmPeriodBlocks} block confirmation period)`
    )
  }

  return `Confirmation issue(s) detected on ${chainInfo.name}:\n- ${issues.join(
    '\n- '
  )}${
    chainState.childLastConfirmedBlock
      ? `\nLast processed child chain block: ${chainState.childLastConfirmedBlock.number}`
      : ''
  }\nValidator whitelist is ${
    validatorWhitelistDisabled ? 'disabled' : 'enabled'
  }.`
}

/**
 * Generates an alert when no creation events are found in the search window
 */
export function generateNoCreationEventsAlert(
  chainInfo: ChainInfo,
  maxDays: number
): string {
  return `No assertion creation events found in the last ${maxDays} days on ${chainInfo.name} - chain may be stalled`
}

/**
 * Generates an alert when there is chain activity but no new assertions
 */
export function generateChainActivityWithoutAssertionsAlert(
  chainInfo: ChainInfo,
  recentHours: number,
  lastProcessedBlock: bigint,
  latestSafeBlock: bigint
): string {
  return (
    `Chain activity detected but no assertions created in the last ${recentHours} hours on ${chainInfo.name}. ` +
    `Last processed block: ${lastProcessedBlock}, Latest safe block: ${latestSafeBlock}`
  )
}

/**
 * Generates an alert for confirmation issues on the parent chain
 */
export function generateParentConfirmationIssuesAlert(
  chainInfo: ChainInfo,
  creationBlock: bigint
): string {
  return (
    `Parent chain confirmation issues on ${chainInfo.name} - assertions not confirming. ` +
    `Last creation at block ${creationBlock}, no confirmations found.`
  )
}

/**
 * Generates an alert for assertion data errors
 */
export function generateAssertionDataErrorAlert(
  chainInfo: ChainInfo,
  error: AssertionDataError,
  options?: { enableAlerting: boolean }
): string {
  const errorMessage = `Assertion data error on ${chainInfo.name}: ${
    error.message
  }${
    error.rawData ? `\nRaw data: ${jsonStringifyWithBigInt(error.rawData)}` : ''
  }`

  if (options?.enableAlerting) {
    reportAssertionMonitorErrorToSlack({
      message: errorMessage,
    })
  }

  return errorMessage
}
