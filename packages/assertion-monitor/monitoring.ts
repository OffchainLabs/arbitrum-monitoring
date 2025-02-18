import { ChildNetwork as ChainInfo } from '../utils'
import { hasChainActivity, getLastProcessedBlock } from './blockchain'
import { PublicClient } from 'viem'
import {
  generateNoAssertionsCreatedAlert,
  generateNoRecentAssertionsAlert,
  generateNoConfirmationsAlert,
  generateAssertionDataErrorAlert,
} from './alerts'
import { AssertionLogs } from './types'
import { AssertionDataError } from './errors'

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

  const hasActivity = await hasChainActivity(
    childChainClient,
    fromBlock,
    latestSafeBlockNumber
  )
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

export async function checkForStaleAssertions(
  childChainInfo: ChainInfo,
  childChainClient: PublicClient,
  parentChainClient: PublicClient,
  sortedAssertionLogs: AssertionLogs,
  latestSafeBlockNumber: bigint,
  validatorWhitelistDisabled: boolean,
  assertionCreationAlertHours: number
): Promise<string[]> {
  console.log('Checking time since last event...')
  const alerts: string[] = []

  const latestAssertionBlock = await parentChainClient.getBlock({
    blockNumber:
      sortedAssertionLogs.createdLogs[sortedAssertionLogs.createdLogs.length - 1]
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
      latestAssertionBlock.number,
      latestSafeBlockNumber
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

export async function checkForConfirmationIssues(
  childChainInfo: ChainInfo,
  childChainClient: PublicClient,
  parentChainClient: PublicClient,
  sortedAssertionLogs: AssertionLogs,
  isBold: boolean,
  validatorWhitelistDisabled: boolean,
  options?: { enableAlerting: boolean }
): Promise<string[]> {
  const alerts: string[] = []

  if (sortedAssertionLogs.confirmedLogs.length === 0) {
    return alerts
  }

  console.log('Checking confirmation status...')
  const latestConfirmationBlock = await parentChainClient.getBlock({
    blockNumber:
      sortedAssertionLogs.confirmedLogs[
        sortedAssertionLogs.confirmedLogs.length - 1
      ].blockNumber,
  })
  const latestParentBlock = await parentChainClient.getBlockNumber()

  // Get both the parent chain block number and the last processed child chain block
  const latestAssertionBlock =
    sortedAssertionLogs.createdLogs[
      sortedAssertionLogs.createdLogs.length - 1
    ].blockNumber
  const lastProcessedChildBlock = await getLastProcessedBlock(
    childChainClient,
    sortedAssertionLogs,
    isBold
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

  if (
    sortedAssertionLogs.createdLogs.length >
      sortedAssertionLogs.confirmedLogs.length &&
    latestParentBlock - latestAssertionBlock >
      BigInt(childChainInfo.confirmPeriodBlocks) &&
    blocksSinceLastConfirmation > BigInt(childChainInfo.confirmPeriodBlocks)
  ) {
    console.log('Confirmation period exceeded, adding alert')
    alerts.push(
      generateNoConfirmationsAlert(
        childChainInfo,
        blocksSinceLastConfirmation,
        lastProcessedChildBlock,
        validatorWhitelistDisabled
      )
    )
  }

  return alerts
} 