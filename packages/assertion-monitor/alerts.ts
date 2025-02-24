import { ChildNetwork as ChainInfo } from '../utils'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'
import { jsonStringifyWithBigInt } from './utils'
import { AssertionDataError } from './errors'
import { Block } from 'viem'
import { ChainState } from './types'

/**
 * Generates an alert when there are confirmation issues on the parent chain
 */
export function generateConfirmationIssuesAlert(
  chainInfo: ChainInfo,
  chainState: ChainState,
  options: {
    validatorWhitelistDisabled: boolean
    confirmPeriodBlocks: number
  }
): string {
  const blocksSinceLastConfirmation =
    chainState.parentLatestBlock?.number ?? 0n

  const confirmationDelayExceedsPeriod =
    blocksSinceLastConfirmation > BigInt(options.confirmPeriodBlocks)

  const issues: string[] = []
  if (confirmationDelayExceedsPeriod) {
    issues.push('There are assertions waiting to be confirmed')
    issues.push(`${options.confirmPeriodBlocks} block confirmation period exceeded (${blocksSinceLastConfirmation} blocks since last confirmation)`)
  }

  return `Confirmation issue(s) detected on ${chainInfo.name}:
${issues.length > 0 ? `\n- ${issues.join('\n- ')}\n` : '\n'}
Last processed child chain block: ${chainState.latestConfirmedBlock?.number ?? 'unknown'}
Validator whitelist is ${options.validatorWhitelistDisabled ? 'disabled' : 'enabled'}.`
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
 * Generates an alert when there are confirmation issues on the parent chain
 */
export function generateParentConfirmationIssuesAlert(
  chainInfo: ChainInfo,
  lastCreationBlock: bigint
): string {
  return `Parent chain confirmation issues detected on ${chainInfo.name}. Last creation block: ${lastCreationBlock}`
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
