import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { analyzeAssertionEvents } from '../monitoring'
import type { ChainState } from '../types'
import { Block } from 'viem'
import {
  NO_CREATION_EVENTS_ALERT,
  CHAIN_ACTIVITY_WITHOUT_ASSERTIONS_ALERT,
  NO_CONFIRMATION_EVENTS_ALERT,
  CONFIRMATION_DELAY_ALERT,
  CREATION_EVENT_STUCK_ALERT,
  NON_BOLD_NO_RECENT_CREATION_ALERT,
  VALIDATOR_WHITELIST_DISABLED_ALERT,
  NO_CONFIRMATION_BLOCKS_WITH_CONFIRMATION_EVENTS_ALERT,
  BOLD_LOW_BASE_STAKE_ALERT,
} from '../alerts'

// Mock constants to avoid importing from the actual constants file
vi.mock('../constants', () => ({
  MAXIMUM_SEARCH_DAYS: 7,
  RECENT_CREATION_CHECK_HOURS: 4,
  CHALLENGE_PERIOD_SECONDS: 6.4 * 24 * 60 * 60, // 6.4 days in seconds
  SEARCH_WINDOW_SECONDS: 7 * 24 * 60 * 60, // 7 days in seconds
  RECENT_ACTIVITY_SECONDS: 4 * 60 * 60, // 4 hours in seconds
  VALIDATOR_AFK_BLOCKS: 50, // Add the validator AFK blocks constant
}))

// Mock chain info
const mockChainInfo = {
  name: 'Test Chain',
  confirmPeriodBlocks: 100,
  ethBridge: {
    rollup: '0x1234567890123456789012345678901234567890',
  },
} as any

// Base timestamp for tests (current time)
const NOW = 1672531200n // 2023-01-01 00:00:00 UTC as bigint

describe('Assertion Health Monitoring', () => {
  // Mock Date.now() to return a consistent timestamp
  let originalDateNow: () => number

  beforeEach(() => {
    originalDateNow = Date.now
    Date.now = vi.fn(() => Number(NOW) * 1000) // Convert to milliseconds
  })

  afterEach(() => {
    Date.now = originalDateNow
  })

  // Helper function to create a basic chain state
  function createBaseChainState(): ChainState {
    return {
      childCurrentBlock: {
        number: 2000n,
        timestamp: NOW - 50n,
        hash: '0x5678' as `0x${string}`,
        parentHash: '0x0000' as `0x${string}`,
      } as Block,
      childLatestCreatedBlock: {
        number: 900n,
        timestamp: NOW - 3600n, // 1 hour ago
        hash: '0xabcd' as `0x${string}`,
        parentHash: '0x0000' as `0x${string}`,
      } as Block,
      childLatestConfirmedBlock: {
        number: 850n,
        timestamp: NOW - 7200n, // 2 hours ago
        hash: '0xef01' as `0x${string}`,
        parentHash: '0x0000' as `0x${string}`,
      } as Block,
      // Parent chain block information
      parentCurrentBlock: {
        number: 150n,
        timestamp: NOW,
        hash: '0xparent1' as `0x${string}`,
        parentHash: '0x0000' as `0x${string}`,
      } as Block,
      parentBlockAtCreation: {
        number: 140n,
        timestamp: NOW - 3600n, // 1 hour ago
        hash: '0xparent2' as `0x${string}`,
        parentHash: '0x0000' as `0x${string}`,
      } as Block,
      parentBlockAtConfirmation: {
        number: 130n,
        timestamp: NOW - 7200n, // 2 hours ago
        hash: '0xparent3' as `0x${string}`,
        parentHash: '0x0000' as `0x${string}`,
      } as Block,
      recentCreationEvent: null,
      recentConfirmationEvent: null,
      isValidatorWhitelistDisabled: false,
      isBaseStakeBelowThreshold: false
    }
  }

  describe('BOLD Chain Tests', () => {
    test('should not alert when everything is normal', async () => {
      const chainState = createBaseChainState()

      // Update the blocks to have a normal confirmation delay
      chainState.childCurrentBlock = {
        ...chainState.childCurrentBlock!,
        number: 2000n,
      } as Block

      chainState.childLatestConfirmedBlock = {
        ...chainState.childLatestConfirmedBlock!,
        number: 1950n, // Only 50 blocks behind, less than threshold
      } as Block

      // Make sure creation events are recent
      chainState.childLatestCreatedBlock = {
        ...chainState.childLatestCreatedBlock!,
        timestamp: NOW - 1000n, // Very recent
        number: 1980n, // Between latest and confirmed
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )

      // Should have no alerts
      expect(alerts.length).toBe(0)
    })

    test('should alert when no creation events are found', async () => {
      const chainState = createBaseChainState()
      chainState.childLatestCreatedBlock = undefined

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )

      expect(alerts[0]).toBe(NO_CREATION_EVENTS_ALERT)
    })

    test('should alert when chain has activity but no recent creation events', async () => {
      const chainState = createBaseChainState()
      // Set creation event to be older than the recent activity threshold (4 hours)
      chainState.childLatestCreatedBlock = {
        ...chainState.childLatestCreatedBlock!,
        timestamp: NOW - BigInt(5 * 60 * 60), // 5 hours ago
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )

      // Check if alerts array exists and has at least one element
      expect(alerts.length).toBeGreaterThan(0)

      // Check for expected alert
      expect(alerts).toContain(CHAIN_ACTIVITY_WITHOUT_ASSERTIONS_ALERT)
    })

    test('should alert when no confirmation events exist', async () => {
      const chainState = createBaseChainState()
      chainState.childLatestConfirmedBlock = undefined

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )

      // Check if alerts array exists and has at least one element
      expect(alerts.length).toBeGreaterThan(0)

      // Check for expected alert
      expect(alerts).toContain(NO_CONFIRMATION_EVENTS_ALERT)
    })

    test('should alert when confirmation delay exceeds period', async () => {
      const chainState = createBaseChainState()

      // Set values to trigger confirmation delay
      chainState.childCurrentBlock = {
        ...chainState.childCurrentBlock!,
        number: 2000n,
      } as Block

      chainState.childLatestConfirmedBlock = {
        ...chainState.childLatestConfirmedBlock!,
        number: 1700n, // 300 blocks behind, exceeds threshold
      } as Block

      // Set parent chain blocks to indicate a delay
      chainState.parentCurrentBlock = {
        ...chainState.parentCurrentBlock!,
        number: 300n,
      } as Block

      chainState.parentBlockAtConfirmation = {
        ...chainState.parentBlockAtConfirmation!,
        number: 100n, // 200 blocks behind, exceeds confirmPeriodBlocks(100) + VALIDATOR_AFK_BLOCKS(50)
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )

      // Check for expected alert
      expect(alerts).toContain(CONFIRMATION_DELAY_ALERT)
    })

    test('should alert when creation event is stuck in challenge period', async () => {
      const chainState = createBaseChainState()
      // Set creation event to be older than the challenge period
      chainState.childLatestCreatedBlock = {
        ...chainState.childLatestCreatedBlock!,
        timestamp: NOW - BigInt(7 * 24 * 60 * 60), // 7 days ago
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )

      // Check if alerts array exists and has at least one element
      expect(alerts.length).toBeGreaterThan(0)

      // Check for expected alert
      expect(alerts).toContain(CREATION_EVENT_STUCK_ALERT)
    })

    test('should include validator whitelist status in confirmation delay alerts', async () => {
      const chainState = createBaseChainState()

      // Set values to trigger confirmation delay
      chainState.childCurrentBlock = {
        ...chainState.childCurrentBlock!,
        number: 2000n,
      } as Block

      chainState.childLatestConfirmedBlock = {
        ...chainState.childLatestConfirmedBlock!,
        number: 1700n, // 300 blocks behind, exceeds threshold
      } as Block

      // Set parent chain blocks to indicate a delay
      chainState.parentCurrentBlock = {
        ...chainState.parentCurrentBlock!,
        number: 300n,
      } as Block

      chainState.parentBlockAtConfirmation = {
        ...chainState.parentBlockAtConfirmation!,
        number: 100n, // 200 blocks behind, exceeds confirmPeriodBlocks(100) + VALIDATOR_AFK_BLOCKS(50)
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )

      // Check for expected alert
      expect(alerts).toContain(CONFIRMATION_DELAY_ALERT)

      // Test with whitelist disabled
      const alertsWithWhitelistDisabled = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        true,
        true
      )

      // Should have both alerts
      expect(alertsWithWhitelistDisabled).toContain(CONFIRMATION_DELAY_ALERT)
      expect(alertsWithWhitelistDisabled).toContain(
        VALIDATOR_WHITELIST_DISABLED_ALERT
      )
    })

    test('should generate multiple alerts when multiple conditions are met', async () => {
      const chainState = createBaseChainState()

      // Set creation event to be older than the recent activity threshold
      chainState.childLatestCreatedBlock = {
        ...chainState.childLatestCreatedBlock!,
        timestamp: NOW - BigInt(5 * 60 * 60), // 5 hours ago
        number: 1800n,
      } as Block

      // Set values to trigger confirmation delay
      chainState.childCurrentBlock = {
        ...chainState.childCurrentBlock!,
        number: 2000n, // Activity since last creation
      } as Block

      chainState.childLatestConfirmedBlock = {
        ...chainState.childLatestConfirmedBlock!,
        number: 1700n, // 300 blocks behind, exceeds threshold
      } as Block

      // Set parent chain blocks to indicate a delay
      chainState.parentCurrentBlock = {
        ...chainState.parentCurrentBlock!,
        number: 300n,
      } as Block

      chainState.parentBlockAtConfirmation = {
        ...chainState.parentBlockAtConfirmation!,
        number: 100n, // 200 blocks behind, exceeds confirmPeriodBlocks(100) + VALIDATOR_AFK_BLOCKS(50)
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )

      // Check that we have multiple alerts
      expect(alerts.length).toBeGreaterThan(1)

      // Check for expected alerts
      expect(alerts).toContain(CHAIN_ACTIVITY_WITHOUT_ASSERTIONS_ALERT)
      expect(alerts).toContain(CONFIRMATION_DELAY_ALERT)
    })

    test('should alert when validator whitelist is disabled', async () => {
      const chainState = createBaseChainState()

      // Test with validator whitelist disabled
      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        true,
        true
      )

      // Check if alerts array exists and has at least one element
      expect(alerts.length).toBeGreaterThan(0)

      // Check for the validator whitelist disabled alert
      expect(alerts).toContain(VALIDATOR_WHITELIST_DISABLED_ALERT)

      // Test with whitelist enabled to confirm no alert is generated
      const alertsWithWhitelist = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )
      expect(alertsWithWhitelist).not.toContain(
        VALIDATOR_WHITELIST_DISABLED_ALERT
      )
    })

    test('should use parent chain blocks for confirmation delay when available', async () => {
      const chainState = createBaseChainState()

      // Set child chain blocks to normal values (no delay based on child blocks)
      chainState.childCurrentBlock = {
        ...chainState.childCurrentBlock!,
        number: 2000n,
      } as Block

      chainState.childLatestConfirmedBlock = {
        ...chainState.childLatestConfirmedBlock!,
        number: 1950n, // Only 50 blocks behind, less than threshold
      } as Block

      // But set parent blocks to indicate a delay
      chainState.parentCurrentBlock = {
        ...chainState.parentCurrentBlock!,
        number: 300n,
      } as Block

      chainState.parentBlockAtConfirmation = {
        ...chainState.parentBlockAtConfirmation!,
        number: 100n, // 200 blocks behind, exceeds confirmPeriodBlocks(100) + VALIDATOR_AFK_BLOCKS(50)
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )

      // Should alert due to parent chain block delay, despite child chain blocks being normal
      expect(alerts).toContain(CONFIRMATION_DELAY_ALERT)
    })

    test('should not generate confirmation delay alert when parent chain block gap is zero', async () => {
      const chainState = createBaseChainState()

      // Set parent chain blocks to have no gap
      chainState.parentCurrentBlock = {
        ...chainState.parentCurrentBlock!,
        number: 200n,
      } as Block

      chainState.parentBlockAtConfirmation = {
        ...chainState.parentBlockAtConfirmation!,
        number: 200n, // Same as current block, so no delay
      } as Block

      // Set child blocks to indicate a delay (which would have triggered an alert in the old implementation)
      chainState.childCurrentBlock = {
        ...chainState.childCurrentBlock!,
        number: 2000n,
      } as Block

      chainState.childLatestConfirmedBlock = {
        ...chainState.childLatestConfirmedBlock!,
        number: 1800n, // 200 blocks behind, would have exceeded threshold for BOLD in old implementation
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )

      // Should NOT alert since parent chain blocks have no gap
      expect(alerts).not.toContain(CONFIRMATION_DELAY_ALERT)
    })

    test('should alert when confirmation events exist but no confirmation blocks found', async () => {
      const chainState = createBaseChainState()
      
      // Set up the inconsistent state: confirmation event exists but no confirmed block
      chainState.childLatestConfirmedBlock = undefined
      
      // Add a mock confirmation event with the correct structure
      chainState.recentConfirmationEvent = {
        blockNumber: 130n,
        args: {
          blockHash: '0xef01' as `0x${string}`,
          sendRoot: '0xabcd' as `0x${string}`,
          assertionHash: '0x1234' as `0x${string}`,
        },
        // Add minimal required properties to satisfy the type
        address: '0x1234' as `0x${string}`,
        data: '0x' as `0x${string}`,
        topics: ['0x1234' as `0x${string}`, '0x5678' as `0x${string}`],
        transactionHash: '0x5678' as `0x${string}`,
        logIndex: 0,
        blockHash: '0xparent3' as `0x${string}`,
        transactionIndex: 0,
        removed: false,
        eventName: 'AssertionConfirmed',
      }

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        true
      )

      // Should contain both the standard no confirmation events alert and the specific inconsistency alert
      expect(alerts).toContain(NO_CONFIRMATION_EVENTS_ALERT)
      expect(alerts).toContain(NO_CONFIRMATION_BLOCKS_WITH_CONFIRMATION_EVENTS_ALERT)
    
    })

    test('should alert when base stake is below threshold and whitelist is disabled for BoLD chain', async () => {
      const chainState = createBaseChainState()
      
      // Set both conditions to trigger alert
      chainState.isBaseStakeBelowThreshold = true
      chainState.isValidatorWhitelistDisabled = true

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        true // isBold
      )

      expect(alerts).toContain(BOLD_LOW_BASE_STAKE_ALERT)

      // Test that alert is not generated when base stake is adequate
      const chainStateWithAdequateStake = {
        ...chainState,
        isBaseStakeBelowThreshold: false
      }

      const alertsWithAdequateStake = await analyzeAssertionEvents(
        chainStateWithAdequateStake,
        mockChainInfo,
        true // isBold
      )

      expect(alertsWithAdequateStake).not.toContain(BOLD_LOW_BASE_STAKE_ALERT)
    })

    test('should not alert for whitelist being disabled on BoLD chain', async () => {
      const chainState = createBaseChainState()
      
      // Enable whitelist disabled flag
      chainState.isValidatorWhitelistDisabled = true

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        true // isBold
      )

      // Should not contain whitelist alert since this is a BoLD chain
      expect(alerts).not.toContain(VALIDATOR_WHITELIST_DISABLED_ALERT)
    })
  })

  describe('Non-BOLD Chain Tests', () => {
    test('should not alert when everything is normal for non-BOLD chain', async () => {
      const chainState = createBaseChainState()

      // Update the blocks to have a normal confirmation delay
      chainState.childCurrentBlock = {
        ...chainState.childCurrentBlock!,
        number: 2000n,
      } as Block

      chainState.childLatestConfirmedBlock = {
        ...chainState.childLatestConfirmedBlock!,
        number: 1950n, // Only 50 blocks behind, less than threshold
      } as Block

      // Make sure creation events are recent
      chainState.childLatestCreatedBlock = {
        ...chainState.childLatestCreatedBlock!,
        timestamp: NOW - 1000n, // Very recent
        number: 1980n, // Between latest and confirmed
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        false
      )

      // Our implementation now generates no alerts for normal operation
      expect(alerts.length).toBe(0)
    })

    test('should alert when no creation events are found for non-BOLD chain', async () => {
      const chainState = createBaseChainState()
      chainState.childLatestCreatedBlock = undefined

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        false
      )

      expect(alerts[0]).toBe(NO_CREATION_EVENTS_ALERT)
    })

    test('should alert when no recent creation events for non-BOLD chain', async () => {
      const chainState = createBaseChainState()
      // Set creation event to be older than the recent activity threshold (4 hours)
      chainState.childLatestCreatedBlock = {
        ...chainState.childLatestCreatedBlock!,
        timestamp: NOW - BigInt(5 * 60 * 60), // 5 hours ago
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        false
      )

      // Check if alerts array exists and has at least one element
      expect(alerts.length).toBeGreaterThan(0)

      // Check for expected alert
      expect(alerts).toContain(NON_BOLD_NO_RECENT_CREATION_ALERT)
    })

    test('should alert when no confirmation events exist for non-BOLD chain', async () => {
      const chainState = createBaseChainState()
      chainState.childLatestConfirmedBlock = undefined

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        false
      )

      // Check if alerts array exists and has at least one element
      expect(alerts.length).toBeGreaterThan(0)

      // Check for expected alert
      expect(alerts).toContain(NO_CONFIRMATION_EVENTS_ALERT)
    })

    test('should alert when confirmation delay exceeds very high threshold for non-BOLD chain', async () => {
      const chainState = createBaseChainState()

      // Set parent chain blocks to indicate a delay
      chainState.parentCurrentBlock = {
        ...chainState.parentCurrentBlock!,
        number: 300n,
      } as Block

      chainState.parentBlockAtConfirmation = {
        ...chainState.parentBlockAtConfirmation!,
        number: 100n, // 200 blocks behind, exceeds confirmPeriodBlocks(100) + VALIDATOR_AFK_BLOCKS(50)
      } as Block

      // Also set child blocks to have a huge gap (but this shouldn't matter anymore)
      chainState.childCurrentBlock = {
        ...chainState.childCurrentBlock!,
        number: 7000n,
      } as Block

      chainState.childLatestConfirmedBlock = {
        ...chainState.childLatestConfirmedBlock!,
        number: 1800n, // 5200 blocks behind
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        false // non-BOLD
      )

      // Check for expected alert - should be triggered by parent chain blocks
      expect(alerts).toContain(CONFIRMATION_DELAY_ALERT)
    })

    test('should not alert for challenge period on non-BOLD chain', async () => {
      const chainState = createBaseChainState()
      // Set creation event to be older than the challenge period (6.4 days)
      chainState.childLatestCreatedBlock = {
        ...chainState.childLatestCreatedBlock!,
        timestamp: NOW - BigInt(7 * 24 * 60 * 60), // 7 days ago
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        false
      )

      // The implementation will generate other alerts, but not CREATION_EVENT_STUCK_ALERT
      expect(alerts).not.toContain(CREATION_EVENT_STUCK_ALERT)

      // But it should contain the NON_BOLD_NO_RECENT_CREATION_ALERT
      expect(alerts).toContain(NON_BOLD_NO_RECENT_CREATION_ALERT)
    })

    test('should generate alerts when extreme conditions are met for non-BOLD chain', async () => {
      const chainState = createBaseChainState()
      // Set creation event to be older than the recent activity threshold
      chainState.childLatestCreatedBlock = {
        ...chainState.childLatestCreatedBlock!,
        timestamp: NOW - BigInt(5 * 60 * 60), // 5 hours ago
        number: 900n,
      } as Block

      // Set parent chain blocks to indicate a delay
      chainState.parentCurrentBlock = {
        ...chainState.parentCurrentBlock!,
        number: 300n,
      } as Block

      chainState.parentBlockAtConfirmation = {
        ...chainState.parentBlockAtConfirmation!,
        number: 100n, // 200 blocks behind, exceeds confirmPeriodBlocks(100) + VALIDATOR_AFK_BLOCKS(50)
      } as Block

      // Also set child blocks to have a huge gap (but this shouldn't matter anymore)
      chainState.childCurrentBlock = {
        ...chainState.childCurrentBlock!,
        number: 7000n,
      } as Block

      chainState.childLatestConfirmedBlock = {
        ...chainState.childLatestConfirmedBlock!,
        number: 1800n, // 5200 blocks behind
      } as Block

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        false // non-BOLD
      )

      // Check for required alerts
      expect(alerts).toContain(CHAIN_ACTIVITY_WITHOUT_ASSERTIONS_ALERT)
      expect(alerts).toContain(NON_BOLD_NO_RECENT_CREATION_ALERT)
      expect(alerts).toContain(CONFIRMATION_DELAY_ALERT)
    })

    test('should alert when validator whitelist is disabled for non-BOLD chain', async () => {
      const chainState = createBaseChainState()

      // Test with validator whitelist disabled
      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        true,
        false
      )

      // Check if alerts array exists and has at least one element
      expect(alerts.length).toBeGreaterThan(0)

      // Check for the validator whitelist disabled alert
      expect(alerts).toContain(VALIDATOR_WHITELIST_DISABLED_ALERT)

      // Test with whitelist enabled to confirm no alert is generated
      const alertsWithWhitelist = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        false
      )
      expect(alertsWithWhitelist).not.toContain(
        VALIDATOR_WHITELIST_DISABLED_ALERT
      )
    })

    test('should alert when confirmation events exist but no confirmation blocks found for non-BOLD chains', async () => {
      const chainState = createBaseChainState()
      
      // Set up the inconsistent state: confirmation event exists but no confirmed block
      chainState.childLatestConfirmedBlock = undefined
      
      // Add a mock confirmation event with the correct structure for NODE_CONFIRMED_EVENT
      chainState.recentConfirmationEvent = {
        blockNumber: 130n,
        args: {
          blockHash: '0xef01' as `0x${string}`,
          sendRoot: '0xabcd' as `0x${string}`,
          nodeNum: 42n,
        },
        // Add minimal required properties to satisfy the type
        address: '0x1234' as `0x${string}`,
        data: '0x' as `0x${string}`,
        topics: ['0x1234' as `0x${string}`, '0x5678' as `0x${string}`],
        transactionHash: '0x5678' as `0x${string}`,
        logIndex: 0,
        blockHash: '0xparent3' as `0x${string}`,
        transactionIndex: 0,
        removed: false,
        eventName: 'NodeConfirmed',
      }

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false,
        false // isBold = false for non-BOLD chain
      )

      // Should contain both the standard no confirmation events alert and the specific inconsistency alert
      expect(alerts).toContain(NO_CONFIRMATION_EVENTS_ALERT)
      expect(alerts).toContain(NO_CONFIRMATION_BLOCKS_WITH_CONFIRMATION_EVENTS_ALERT)
    })
  })

  describe('Classic Chain Tests', () => {
    test('should alert when validator whitelist is disabled on Classic chain', async () => {
      const chainState = createBaseChainState()
      
      // Enable whitelist disabled flag
      chainState.isValidatorWhitelistDisabled = true

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false // isBold
      )

      expect(alerts).toContain(VALIDATOR_WHITELIST_DISABLED_ALERT)

      // Test that alert is not generated when whitelist is enabled
      const chainStateWithWhitelist = {
        ...chainState,
        isValidatorWhitelistDisabled: false
      }

      const alertsWithWhitelist = await analyzeAssertionEvents(
        chainStateWithWhitelist,
        mockChainInfo,
        false // isBold
      )

      expect(alertsWithWhitelist).not.toContain(VALIDATOR_WHITELIST_DISABLED_ALERT)
    })

    test('should not alert for base stake on Classic chain', async () => {
      const chainState = createBaseChainState()
      
      // Set base stake below threshold
      chainState.isBaseStakeBelowThreshold = true

      const alerts = await analyzeAssertionEvents(
        chainState,
        mockChainInfo,
        false // isBold
      )

      // Should not contain base stake alert since this is a Classic chain
      expect(alerts).not.toContain(BOLD_LOW_BASE_STAKE_ALERT)
    })
  })
})
