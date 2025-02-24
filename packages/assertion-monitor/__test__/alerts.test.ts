import { createPublicClient, http, PublicClient } from 'viem'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createChildChainClient,
  fetchMostRecentConfirmationEvent,
  fetchMostRecentCreationEvent,
  getLatestConfirmedBlock,
  getLatestCreationBlock,
} from '../blockchain'
import { getChainFromId } from '../chains'
import {
  analyzeConfirmationEvents,
  analyzeCreationEvents,
  checkConfirmationDelays,
} from '../monitoring'
import type { ChainState, ConfirmationEvent, CreationEvent } from '../types'
import { boldChainInfo } from './testConfigs'

// Known block range where we have events (Arbitrum Sepolia)
const BOLD_FROM_BLOCK = 7627075n
const BOLD_TO_BLOCK = 7637075n

describe('Alert Generation', () => {
  let client: PublicClient
  let childChainClient: PublicClient
  let chainState: ChainState

  beforeEach(async () => {
    const parentChain = getChainFromId(boldChainInfo.parentChainId)
    client = createPublicClient({
      chain: parentChain,
      transport: http(boldChainInfo.parentRpcUrl),
    })
    childChainClient = createChildChainClient(boldChainInfo)

    // Get most recent events for the known block range
    const [recentCreation, recentConfirmation] = await Promise.all([
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
      ),
    ])

    const latestConfirmedBlock = await getLatestConfirmedBlock(
      childChainClient,
      recentConfirmation
    )

    const latestCreationBlock = await getLatestCreationBlock(
      childChainClient,
      recentCreation,
      true
    )

    // Set up base chain state
    const [parentLatestBlock, childLatestBlock] = await Promise.all([
      client.getBlock({ blockTag: 'latest' }),
      childChainClient.getBlock({ blockTag: 'latest' }),
    ])

    chainState = {
      parentLatestBlock,
      childLatestBlock,
      latestConfirmedBlock,
      latestCreationBlock,
    }
  })

  describe('Creation Event Alerts', () => {
    test('should generate no creation events alert when no events found', async () => {
      const modifiedState: ChainState = {
        ...chainState,
        latestCreationBlock: undefined,
      }
      const alerts = await analyzeCreationEvents(modifiedState, boldChainInfo)
      expect(alerts.length).toBe(1)
      expect(alerts[0]).toContain(
        'No assertion creation events found in the last 7 days'
      )
    })

    test('should generate chain activity without assertions alert', async () => {
      // Modify chain state to simulate activity without recent assertions
      const modifiedState: ChainState = {
        ...chainState,
        latestConfirmedBlock: {
          ...chainState.childLatestBlock,
          number: chainState.childLatestBlock.number! - 10000n,
          timestamp: chainState.childLatestBlock.timestamp - 86400n * 2n, // 2 days old
        },
      }

      const alerts = await analyzeCreationEvents(modifiedState, boldChainInfo)
      expect(alerts.length).toBe(1)
      expect(alerts[0]).toContain(
        'Chain activity detected but no assertions created'
      )
    })
  })

  describe('Confirmation Event Alerts', () => {
    test('should generate ethereum confirmation issues alert', async () => {
      // Modify chain state to simulate old creation without confirmation
      const modifiedState: ChainState = {
        ...chainState,
        latestCreationBlock: {
          ...chainState.childLatestBlock,
          number: chainState.childLatestBlock.number! - 10000n,
          timestamp: chainState.childLatestBlock.timestamp - 86400n * 5n, // 5 days old
        },
        latestConfirmedBlock: undefined,
      }

      const alerts = await analyzeConfirmationEvents(
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
        latestConfirmedBlock: {
          ...chainState.childLatestBlock,
          number: chainState.childLatestBlock.number! - 100n,
          timestamp: chainState.childLatestBlock.timestamp - 3600n, // 1 hour old
        },
      }

      const alerts = await analyzeConfirmationEvents(
        modifiedState,
        boldChainInfo
      )
      expect(alerts.length).toBe(0)
    })
  })

  describe('Confirmation Delay Alerts', () => {
    test('should generate alerts for unconfirmed assertions', async () => {
      if (chainState.latestCreationBlock && chainState.latestConfirmedBlock) {
        // Modify confirmation to simulate unconfirmed assertions
        const modifiedState: ChainState = {
          ...chainState,
          childLatestBlock: {
            ...chainState.childLatestBlock,
            number: chainState.childLatestBlock.number! - 1000n,
          },
          latestConfirmedBlock: {
            ...chainState.latestConfirmedBlock,
            number: chainState.latestCreationBlock.number! - 1000n,
          },
        }

        const alerts = await checkConfirmationDelays(
          boldChainInfo,
          modifiedState,
          false // validatorWhitelistDisabled
        )
        expect(alerts.length).toBe(1)
        expect(alerts[0]).toContain('Confirmation issue(s) detected')
        expect(alerts[0]).toContain(
          'There are assertions waiting to be confirmed'
        )
      }
    })

    test('should generate alerts for exceeded confirmation period', async () => {
      if (chainState.latestCreationBlock && chainState.latestConfirmedBlock) {
        // Modify chain state to simulate long delay
        const modifiedState: ChainState = {
          ...chainState,
          parentLatestBlock: {
            ...chainState.parentLatestBlock!,
            number:
              chainState.latestCreationBlock.number! +
              BigInt(boldChainInfo.confirmPeriodBlocks * 2),
          },
          latestConfirmedBlock: {
            ...chainState.latestConfirmedBlock!,
            number:
              chainState.latestCreationBlock.number! -
              BigInt(boldChainInfo.confirmPeriodBlocks),
          },
        }

        const alerts = await checkConfirmationDelays(
          boldChainInfo,
          modifiedState,
          false // validatorWhitelistDisabled
        )
        expect(alerts.length).toBe(1)
        expect(alerts[0]).toContain('Confirmation issue(s) detected')
        expect(alerts[0]).toContain(
          `${boldChainInfo.confirmPeriodBlocks} block confirmation period`
        )
      }
    })

    test('should not generate alerts when confirmations are timely', async () => {
      if (chainState.latestCreationBlock && chainState.latestConfirmedBlock) {
        // Modify chain state to simulate recent confirmation
        const modifiedState: ChainState = {
          ...chainState,
          childLatestBlock: {
            ...chainState.childLatestBlock!,
            number: chainState.latestConfirmedBlock.number! + 100n,
          },
        }

        const alerts = await checkConfirmationDelays(
          boldChainInfo,
          modifiedState,
          false // validatorWhitelistDisabled
        )
        expect(alerts.length).toBe(0)
      }
    })
  })
})
