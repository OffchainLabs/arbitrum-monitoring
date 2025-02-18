import { ChildNetwork as ChainInfo } from '../utils'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'
import { jsonStringifyWithBigInt } from './utils'
import { AssertionDataError } from './errors'

export function generateNoAssertionsCreatedAlert(
  chainInfo: ChainInfo,
  durationString: string,
  isLatestSafeBlockWithinRange: boolean,
  timestampOfLatestSafeBlock: string,
  latestSafeBlockNumber: bigint,
  validatorWhitelistDisabled: boolean
): string {
  return `No assertions created on ${
    chainInfo.name
  } ${durationString} despite chain activity. Latest batch ${
    isLatestSafeBlockWithinRange ? 'was' : 'was not'
  } posted within this duration, at ${timestampOfLatestSafeBlock} (block ${latestSafeBlockNumber}). Validator whitelist is ${
    validatorWhitelistDisabled ? 'disabled' : 'enabled'
  }.`
}

export function generateNoRecentAssertionsAlert(
  chainInfo: ChainInfo,
  hoursSinceLastAssertion: bigint,
  latestAssertionBlockNumber: bigint,
  latestSafeBlockNumber: bigint,
  validatorWhitelistDisabled: boolean
): string {
  return `No assertions created on ${
    chainInfo.name
  } in the last ${hoursSinceLastAssertion} hours despite chain activity. Last processed parent chain block: ${latestAssertionBlockNumber}, Latest Safe block: ${latestSafeBlockNumber}, Gap: ${
    latestSafeBlockNumber - latestAssertionBlockNumber
  } blocks. Validator whitelist is ${
    validatorWhitelistDisabled ? 'disabled' : 'enabled'
  }.`
}

export function generateConfirmationIssuesAlert(
  chainInfo: ChainInfo,
  {
    hasUnconfirmedAssertions,
    assertionAgeExceedsConfirmPeriod,
    confirmationDelayExceedsPeriod,
    blocksSinceLastConfirmation,
    lastProcessedChildBlock,
    validatorWhitelistDisabled,
    confirmPeriodBlocks,
  }: {
    hasUnconfirmedAssertions: boolean,
    assertionAgeExceedsConfirmPeriod: boolean,
    confirmationDelayExceedsPeriod: boolean,
    blocksSinceLastConfirmation: bigint,
    lastProcessedChildBlock: bigint | undefined,
    validatorWhitelistDisabled: boolean,
    confirmPeriodBlocks: number,
  }
): string {
  const issues: string[] = [];
  
  if (hasUnconfirmedAssertions) {
    issues.push("There are assertions waiting to be confirmed");
  }
  
  if (assertionAgeExceedsConfirmPeriod) {
    issues.push(`The oldest unconfirmed assertion has exceeded the ${confirmPeriodBlocks} block confirmation period`);
  }
  
  if (confirmationDelayExceedsPeriod) {
    const confirmPeriodExceededBy = blocksSinceLastConfirmation - BigInt(confirmPeriodBlocks);
    issues.push(`No confirmations for ${blocksSinceLastConfirmation} blocks (${confirmPeriodExceededBy} blocks over the ${confirmPeriodBlocks} block confirmation period)`);
  }

  return `Confirmation issue(s) detected on ${chainInfo.name}:\n- ${issues.join('\n- ')}${
    lastProcessedChildBlock
      ? `\nLast processed child chain block: ${lastProcessedChildBlock}`
      : ''
  }\nValidator whitelist is ${validatorWhitelistDisabled ? 'disabled' : 'enabled'}.`
}

export function generateAssertionDataErrorAlert(
  chainInfo: ChainInfo,
  error: AssertionDataError,
  options?: { enableAlerting: boolean }
): string {
  const errorMessage = `Assertion data error on ${chainInfo.name}: ${
    error.message
  }${error.rawData ? `\nRaw data: ${jsonStringifyWithBigInt(error.rawData)}` : ''}`

  if (options?.enableAlerting) {
    reportAssertionMonitorErrorToSlack({
      message: errorMessage,
    })
  }

  return errorMessage
} 