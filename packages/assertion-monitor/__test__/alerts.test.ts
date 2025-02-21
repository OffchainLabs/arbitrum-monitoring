import { createPublicClient, http, PublicClient, Block } from 'viem'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createChildChainClient,
  fetchMostRecentCreationEvent,
  fetchMostRecentConfirmationEvent,
} from '../blockchain'
import { getChainFromId } from '../chains'
import { analyzeCreationEvents, analyzeConfirmationEvents, checkConfirmationDelays } from '../monitoring'
import { boldChainInfo } from './testConfigs'
import type { ChainState, CreationEvent, ConfirmationEvent } from '../types'

// Known block range where we have events (Arbitrum Sepolia)
const BOLD_FROM_BLOCK = 7627075n
const BOLD_TO_BLOCK = 7637075n

describe('Alert Generation', () => {
  let client: PublicClient
  let childChainClient: PublicClient
  let recentCreation: CreationEvent | null = null
  let recentConfirmation: ConfirmationEvent | null = null
  let chainState: ChainState

  beforeEach(async () => {
    const parentChain = getChainFromId(boldChainInfo.parentChainId)
    client = createPublicClient({
      chain: parentChain,
      transport: http(boldChainInfo.parentRpcUrl),
    })
    childChainClient = createChildChainClient(boldChainInfo)

    // Get most recent events for the known block range
    const [creation, confirmation] = await Promise.all([
      fetchMostRecentCreationEvent<CreationEvent>(
        BOLD_FROM_BLOCK,
        BOLD_TO_BLOCK,
        client,
        boldChainInfo.ethBridge.rollup,
        true
      ),
      fetchMostRecentConfirmationEvent<ConfirmationEvent>(
        BOLD_FROM_BLOCK,
        BOLD_TO_BLOCK,
        client,
        boldChainInfo.ethBridge.rollup,
        true
      )
    ])
    recentCreation = creation
    recentConfirmation = confirmation

    // Set up base chain state
    const [parentLatestBlockNumber, childLatestSafeBlock] = await Promise.all([
      client.getBlockNumber(),
      childChainClient.getBlock({ blockTag: 'safe' }),
    ])

    chainState = {
      parentLatestBlockNumber,
      childLatestSafeBlock,
      childLastConfirmedBlock: childLatestSafeBlock
    }
  })

  describe('Creation Event Alerts', () => {
    test('should generate no creation events alert when no events found', async () => {
      const alerts = await analyzeCreationEvents(null, chainState, boldChainInfo)
      expect(alerts.length).toBe(1)
      expect(alerts[0]).toContain('No assertion creation events found in the last 7 days')
    })

    test('should generate chain activity without assertions alert', async () => {
      // Modify chain state to simulate activity without recent assertions
      const modifiedState: ChainState = {
        ...chainState,
        childLastConfirmedBlock: {
          ...chainState.childLatestSafeBlock,
          number: chainState.childLatestSafeBlock.number! - 10000n,
          timestamp: chainState.childLatestSafeBlock.timestamp - 86400n * 2n // 2 days old
        }
      }
      
      const alerts = await analyzeCreationEvents(recentCreation, modifiedState, boldChainInfo)
      expect(alerts.length).toBe(1)
      expect(alerts[0]).toContain('Chain activity detected but no assertions created')
    })
  })

  describe('Confirmation Event Alerts', () => {
    test('should generate ethereum confirmation issues alert', async () => {
      // Modify chain state to simulate old creation without confirmation
      const modifiedState: ChainState = {
        ...chainState,
        childLastConfirmedBlock: {
          ...chainState.childLatestSafeBlock,
          number: chainState.childLatestSafeBlock.number! - 10000n,
          timestamp: chainState.childLatestSafeBlock.timestamp - 86400n * 5n // 5 days old
        }
      }

      const alerts = await analyzeConfirmationEvents(
        null, // No confirmation
        recentCreation,
        modifiedState,
        boldChainInfo
      )
      expect(alerts.length).toBe(1)
      expect(alerts[0]).toContain('Parent chain confirmation issues')
    })

    test('should not generate alerts when confirmations are recent', async () => {
      // Modify chain state to simulate recent confirmation
      const modifiedState: ChainState = {
        ...chainState,
        childLastConfirmedBlock: {
          ...chainState.childLatestSafeBlock,
          number: chainState.childLatestSafeBlock.number! - 100n,
          timestamp: chainState.childLatestSafeBlock.timestamp - 3600n // 1 hour old
        }
      }

      const alerts = await analyzeConfirmationEvents(
        recentConfirmation,
        recentCreation,
        modifiedState,
        boldChainInfo
      )
      expect(alerts.length).toBe(0)
    })
  })

  describe('Confirmation Delay Alerts', () => {
    test('should generate alerts for unconfirmed assertions', async () => {
      if (recentCreation && recentConfirmation) {
        // Modify confirmation to simulate unconfirmed assertions
        const modifiedConfirmation = {
          ...recentConfirmation,
          blockNumber: recentCreation.blockNumber - 1000n
        }

        const alerts = await checkConfirmationDelays(
          boldChainInfo,
          chainState,
          recentCreation,
          modifiedConfirmation,
          false // validatorWhitelistDisabled
        )
        expect(alerts.length).toBe(1)
        expect(alerts[0]).toContain('Confirmation issue(s) detected')
        expect(alerts[0]).toContain('There are assertions waiting to be confirmed')
      }
    })

    test('should generate alerts for exceeded confirmation period', async () => {
      if (recentCreation && recentConfirmation) {
        // Modify chain state to simulate long delay
        const modifiedState: ChainState = {
          ...chainState,
          parentLatestBlockNumber: recentCreation.blockNumber + BigInt(boldChainInfo.confirmPeriodBlocks * 2),
          childLastConfirmedBlock: {
            ...chainState.childLastConfirmedBlock!,
            number: recentCreation.blockNumber - BigInt(boldChainInfo.confirmPeriodBlocks)
          }
        }

        const alerts = await checkConfirmationDelays(
          boldChainInfo,
          modifiedState,
          recentCreation,
          recentConfirmation,
          false // validatorWhitelistDisabled
        )
        expect(alerts.length).toBe(1)
        expect(alerts[0]).toContain('Confirmation issue(s) detected')
        expect(alerts[0]).toContain(`${boldChainInfo.confirmPeriodBlocks} block confirmation period`)
      }
    })

    test('should not generate alerts when confirmations are timely', async () => {
      if (recentCreation && recentConfirmation) {
        // Modify chain state to simulate recent confirmation
        const modifiedState: ChainState = {
          ...chainState,
          parentLatestBlockNumber: recentConfirmation.blockNumber + 100n
        }

        const alerts = await checkConfirmationDelays(
          boldChainInfo,
          modifiedState,
          recentCreation,
          recentConfirmation,
          false // validatorWhitelistDisabled
        )
        expect(alerts.length).toBe(0)
      }
    })
  })
}) 