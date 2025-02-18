import { ChildNetwork as ChainInfo } from '../utils'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'
import { jsonStringifyWithBigInt } from './utils'
import { AssertionDataError } from './index'

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

export function generateNoConfirmationsAlert(
  chainInfo: ChainInfo,
  blocksSinceLastConfirmation: bigint,
  lastProcessedChildBlock: bigint | undefined,
  validatorWhitelistDisabled: boolean
): string {
  return `No assertion confirmations on ${
    chainInfo.name
  } for ${blocksSinceLastConfirmation} blocks (confirm period is ${
    chainInfo.confirmPeriodBlocks
  } blocks). This is ${
    blocksSinceLastConfirmation - BigInt(chainInfo.confirmPeriodBlocks)
  } blocks over the limit.${
    lastProcessedChildBlock
      ? ` Last processed child chain block: ${lastProcessedChildBlock}.`
      : ''
  } Validator whitelist is ${validatorWhitelistDisabled ? 'disabled' : 'enabled'}.`
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