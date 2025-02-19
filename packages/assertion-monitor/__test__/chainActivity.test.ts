import { createPublicClient, http } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  createChildChainClient,
  getLastProcessedBlock,
  getLastConfirmedBlock,
  hasChainActivity,
  processChunkedRange,
} from '../blockchain'
import { getChainFromId } from '../chains'
import {
  checkForConfirmationIssues,
  checkForStaleAssertions,
} from '../monitoring'
import { sortAndMergeAssertionLogs } from '../utils'
import { boldChainInfo } from './testConfigs'

describe('Chain Activity Monitoring', () => {
  const childChainClient = createChildChainClient(boldChainInfo)
  const parentChain = getChainFromId(boldChainInfo.parentChainId)
  const parentChainClient = createPublicClient({
    chain: parentChain,
    transport: http(boldChainInfo.parentRpcUrl),
  })

  test('should track chain activity and process assertions', async () => {
    // Get current chain state
    const latestBlock = await childChainClient.getBlockNumber()
    const latestSafeBlock = await childChainClient.getBlock({
      blockTag: 'safe',
    })

    // Look back only 10k blocks for faster test execution
    const fromBlock = latestBlock - 10000n

    console.log('Analyzing chain activity between blocks:', {
      fromBlock,
      latestBlock,
      range: latestBlock - fromBlock,
    })

    // Get assertion data including confirmations
    const rawAssertionLogs = await processChunkedRange(
      fromBlock,
      latestBlock,
      parentChainClient,
      boldChainInfo.ethBridge.rollup,
      true // BOLD mode
    )

    const sortedLogs = sortAndMergeAssertionLogs(rawAssertionLogs)
    console.log('Assertion logs found:', {
      created: sortedLogs.createdLogs.length,
      confirmed: sortedLogs.confirmedLogs.length,
    })

    // Test chain activity detection
    const hasActivityResult = await hasChainActivity(
      childChainClient,
      sortedLogs
    )
    // Chain should be active if we have safe blocks, even without assertions
    expect(hasActivityResult).toBe(true)

    let lastProcessedBlock: bigint | undefined
    let lastConfirmedBlock: bigint | undefined

    // If we have assertions, verify block progression
    if (sortedLogs.createdLogs.length > 0) {
      lastProcessedBlock = await getLastProcessedBlock(
        childChainClient,
        sortedLogs,
        true
      )
      expect(lastProcessedBlock).toBeLessThanOrEqual(latestSafeBlock.number)
      expect(lastProcessedBlock).toBeGreaterThan(0n)

      lastConfirmedBlock = getLastConfirmedBlock(sortedLogs)
      if (lastConfirmedBlock) {
        expect(lastConfirmedBlock).toBeLessThanOrEqual(latestBlock)
        expect(lastProcessedBlock).toBeGreaterThanOrEqual(lastConfirmedBlock)

        // Check confirmation delay
        const confirmationDelay = latestBlock - lastConfirmedBlock
        console.log('Confirmation metrics:', {
          confirmPeriodBlocks: boldChainInfo.confirmPeriodBlocks,
          currentDelay: confirmationDelay,
          isWithinPeriod: confirmationDelay <= BigInt(boldChainInfo.confirmPeriodBlocks),
        })
      }

      // Test stale assertion detection only if we have created logs
      const staleResult = await checkForStaleAssertions(
        boldChainInfo,
        childChainClient,
        parentChainClient,
        sortedLogs,
        latestSafeBlock.number,
        true,
        4 // 4 hour threshold
      )
      expect(Array.isArray(staleResult)).toBe(true)
    }

    // Test confirmation issues detection only if we have confirmed logs
    if (sortedLogs.confirmedLogs.length > 0) {
      const confirmationResult = await checkForConfirmationIssues(
        boldChainInfo,
        childChainClient,
        parentChainClient,
        sortedLogs,
        true,
        true,
        { enableAlerting: false }
      )
      expect(Array.isArray(confirmationResult)).toBe(true)
    }

    // Log results for analysis
    console.log('Monitoring results:', {
      hasActivity: hasActivityResult,
      lastProcessedBlock,
      lastConfirmedBlock,
      createdLogs: sortedLogs.createdLogs.length,
      confirmedLogs: sortedLogs.confirmedLogs.length,
    })
  }, 30000)
})
