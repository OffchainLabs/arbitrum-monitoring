import { PublicClient } from 'viem'
import { ChildNetwork as ChainInfo } from '../utils'
import {
  generateAssertionDataErrorAlert,
  generateConfirmationIssuesAlert,
  generateNoAssertionsCreatedAlert,
  generateNoRecentAssertionsAlert,
} from './alerts'
import { getLastProcessedBlock, hasChainActivity } from './blockchain'
import { AssertionDataError } from './errors'
import { AssertionLogs } from './types'

/**
 * Monitors chain activity and generates alerts when no assertions are found despite chain activity.
 */
export async function checkChainActivityWhenNoAssertions(
  childChainInfo: ChainInfo,
  childChainClient: PublicClient,
  fromBlock: bigint,
  latestSafeBlockNumber: bigint,
  durationString: string,
  isLatestSafeBlockWithinRange: boolean,
  timestampOfLatestSafeBlock: string,
  validatorWhitelistDisabled: boolean
): Promise<string[]> {
  console.log('No creation events found, checking for chain activity...')

  const alerts: string[] = []

  const hasActivity = await hasChainActivity(childChainClient, fromBlock)
  console.log(`Chain activity detected: ${hasActivity}`)

  if (hasActivity) {
    alerts.push(
      generateNoAssertionsCreatedAlert(
        childChainInfo,
        durationString,
        isLatestSafeBlockWithinRange,
        timestampOfLatestSafeBlock,
        latestSafeBlockNumber,
        validatorWhitelistDisabled
      )
    )
  }

  return alerts
}

/**
 * Monitors assertion staleness by checking time since last assertion and chain activity.
 */
export async function checkForStaleAssertions(
  childChainInfo: ChainInfo,
  childChainClient: PublicClient,
  parentChainClient: PublicClient,
  assertionLogs: AssertionLogs,
  latestSafeBlockNumber: bigint,
  validatorWhitelistDisabled: boolean,
  assertionCreationAlertHours: number
): Promise<string[]> {
  console.log('Checking time since last event...')
  const alerts: string[] = []

  const latestAssertionBlock = await parentChainClient.getBlock({
    blockNumber:
      assertionLogs.createdLogs[assertionLogs.createdLogs.length - 1]
        .blockNumber,
  })
  const hoursSinceLastAssertion =
    (BigInt(Math.floor(Date.now() / 1000)) - latestAssertionBlock.timestamp) /
    BigInt(3600)
  console.log(`Hours since last assertion: ${hoursSinceLastAssertion}`)

  if (hoursSinceLastAssertion > BigInt(assertionCreationAlertHours)) {
    console.log(
      `Time since last event (${hoursSinceLastAssertion} hours) exceeds threshold (${assertionCreationAlertHours} hours), checking for activity...`
    )
    // Check for activity since the last assertion
    const hasActivity = await hasChainActivity(
      childChainClient,
      latestAssertionBlock.number
    )
    console.log(`Chain activity detected: ${hasActivity}`)

    if (hasActivity) {
      alerts.push(
        generateNoRecentAssertionsAlert(
          childChainInfo,
          hoursSinceLastAssertion,
          latestAssertionBlock.number,
          latestSafeBlockNumber,
          validatorWhitelistDisabled
        )
      )
    }
  }

  return alerts
}

/**
 * Monitors assertion confirmation delays and generates alerts when confirmations exceed the expected period.
 */
export async function checkForConfirmationIssues(
  childChainInfo: ChainInfo,
  childChainClient: PublicClient,
  parentChainClient: PublicClient,
  assertionLogs: AssertionLogs,
  isUsingBoldProtocol: boolean,
  validatorWhitelistDisabled: boolean,
  options?: { enableAlerting: boolean }
): Promise<string[]> {
  const alerts: string[] = []

  if (assertionLogs.confirmedLogs.length === 0) {
    return alerts
  }

  console.log('Checking confirmation status...')
  const latestConfirmationBlock = await parentChainClient.getBlock({
    blockNumber:
      assertionLogs.confirmedLogs[assertionLogs.confirmedLogs.length - 1]
        .blockNumber,
  })
  const latestParentBlock = await parentChainClient.getBlockNumber()

  // Get both the parent chain block number and the last processed child chain block
  const latestAssertionBlock =
    assertionLogs.createdLogs[assertionLogs.createdLogs.length - 1].blockNumber
  const lastProcessedChildBlock = await getLastProcessedBlock(
    childChainClient,
    assertionLogs,
    isUsingBoldProtocol
  ).catch((error: unknown) => {
    if (error instanceof AssertionDataError) {
      const errorMessage = generateAssertionDataErrorAlert(
        childChainInfo,
        error,
        options
      )
      console.error(errorMessage)
      alerts.push(errorMessage)
    }
    return latestAssertionBlock
  })

  const blocksSinceLastConfirmation =
    latestParentBlock - latestConfirmationBlock.number
  console.log(
    `Blocks since last confirmation: ${blocksSinceLastConfirmation} (confirm period: ${childChainInfo.confirmPeriodBlocks})`
  )

  const hasUnconfirmedAssertions =
    assertionLogs.createdLogs.length > assertionLogs.confirmedLogs.length
  const assertionAgeExceedsConfirmPeriod =
    latestParentBlock - latestAssertionBlock >
    BigInt(childChainInfo.confirmPeriodBlocks)
  const confirmationDelayExceedsPeriod =
    blocksSinceLastConfirmation > BigInt(childChainInfo.confirmPeriodBlocks)

  if (
    hasUnconfirmedAssertions ||
    assertionAgeExceedsConfirmPeriod ||
    confirmationDelayExceedsPeriod
  ) {
    console.log('Confirmation issue(s) detected:')
    if (hasUnconfirmedAssertions)
      console.log('- Unconfirmed assertions present')
    if (assertionAgeExceedsConfirmPeriod)
      console.log('- Assertion age exceeds confirm period')
    if (confirmationDelayExceedsPeriod)
      console.log('- Confirmation delay exceeds period')

    alerts.push(
      generateConfirmationIssuesAlert(childChainInfo, {
        hasUnconfirmedAssertions,
        assertionAgeExceedsConfirmPeriod,
        confirmationDelayExceedsPeriod,
        blocksSinceLastConfirmation,
        lastProcessedChildBlock,
        validatorWhitelistDisabled,
        confirmPeriodBlocks: childChainInfo.confirmPeriodBlocks,
      })
    )
  }

  return alerts
}
