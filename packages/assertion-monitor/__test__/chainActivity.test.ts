import { createPublicClient, http } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  createChildChainClient,
  fetchMostRecentConfirmationEvent,
  fetchMostRecentCreationEvent,
  hasChainActivity,
} from '../blockchain'
import { getChainFromId } from '../chains'
import {
  analyzeConfirmationEvents,
  analyzeCreationEvents,
  checkConfirmationDelays,
} from '../monitoring'
import type { ChainState, ConfirmationEvent, CreationEvent } from '../types'
import { extractBoldBlockHash } from '../utils'
import { boldChainInfo } from './testConfigs'

// Known block range where we have events (Arbitrum Sepolia)
const BOLD_FROM_BLOCK = 7627075n
const BOLD_TO_BLOCK = 7637075n

describe('Chain Activity Monitoring', () => {
  const childChainClient = createChildChainClient(boldChainInfo)
  const parentChain = getChainFromId(boldChainInfo.parentChainId)
  const parentChainClient = createPublicClient({
    chain: parentChain,
    transport: http(boldChainInfo.parentRpcUrl),
  })

  test('should track chain activity and process assertions', async () => {
    // Get current chain state
    const [latestBlock, latestSafeBlock] = await Promise.all([
      parentChainClient.getBlockNumber(),
      childChainClient.getBlock({ blockTag: 'safe' }),
    ])

    console.log('Analyzing chain activity between blocks:', {
      fromBlock: BOLD_FROM_BLOCK,
      toBlock: BOLD_TO_BLOCK,
      range: BOLD_TO_BLOCK - BOLD_FROM_BLOCK,
    })

    // Get most recent creation and confirmation events
    const [recentCreation, recentConfirmation] = await Promise.all([
      fetchMostRecentCreationEvent<CreationEvent>(
        BOLD_FROM_BLOCK,
        BOLD_TO_BLOCK,
        parentChainClient,
        boldChainInfo.ethBridge.rollup,
        true
      ),
      fetchMostRecentConfirmationEvent<ConfirmationEvent>(
        BOLD_FROM_BLOCK,
        BOLD_TO_BLOCK,
        parentChainClient,
        boldChainInfo.ethBridge.rollup,
        true
      ),
    ])

    console.log('Most recent events found:', {
      hasCreation: !!recentCreation,
      hasConfirmation: !!recentConfirmation,
      creationBlock: recentCreation?.blockNumber,
      confirmationBlock: recentConfirmation?.blockNumber,
    })

    // Get the last confirmed block if we have a creation event
    let lastConfirmedBlock
    if (recentCreation) {
      const assertionData = recentCreation.args.assertion
      const lastConfirmedBlockHash = extractBoldBlockHash(assertionData)
      lastConfirmedBlock = await childChainClient.getBlock({
        blockHash: lastConfirmedBlockHash,
      })
    }

    const chainState: ChainState = {
      parentLatestBlockNumber: latestBlock,
      childLatestSafeBlock: latestSafeBlock,
      childLastConfirmedBlock: lastConfirmedBlock
    }

    // Test chain activity detection
    const hasActivityResult = await hasChainActivity(
      childChainClient,
      recentConfirmation?.blockNumber || BOLD_FROM_BLOCK
    )
    // Chain should be active if we have safe blocks, even without assertions
    expect(hasActivityResult).toBe(true)

    // Analyze creation events
    const creationAlerts = await analyzeCreationEvents(
      recentCreation,
      chainState,
      boldChainInfo
    )
    expect(Array.isArray(creationAlerts)).toBe(true)

    // Analyze confirmation events
    const confirmationAlerts = await analyzeConfirmationEvents(
      recentConfirmation,
      recentCreation,
      chainState,
      boldChainInfo
    )
    expect(Array.isArray(confirmationAlerts)).toBe(true)

    // Check confirmation delays
    const confirmationDelayAlerts = await checkConfirmationDelays(
      boldChainInfo,
      chainState,
      recentCreation,
      recentConfirmation,
      false
    )
    expect(Array.isArray(confirmationDelayAlerts)).toBe(true)

    // Log results for analysis
    console.log('Monitoring results:', {
      hasActivity: hasActivityResult,
      creationAlerts: creationAlerts.length,
      confirmationAlerts: confirmationAlerts.length,
      confirmationDelayAlerts: confirmationDelayAlerts.length,
      hasCreation: !!recentCreation,
      hasConfirmation: !!recentConfirmation,
      chainState: {
        latestBlock,
        latestSafeBlock: latestSafeBlock.number,
        lastConfirmedBlock: lastConfirmedBlock?.number ?? 0n,
      },
    })
  }, 30000)
})
