import { beforeAll, describe, expect, test, vi } from 'vitest'
import { setIgnoreList, shouldIgnoreFunctionSelector } from '../ignoreList'
import { createTestChainConfig } from './testConfigs'

// Mock viem modules
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getTransaction: vi.fn(({ hash }) => {
        // Return transaction with ignored function selector
        return Promise.resolve({
          hash,
          from: '0xBatchPoster000000000000000000000000000001',
          input: '0xasdf1234' + '0'.repeat(200), // Ignored function selector + data
          blockNumber: 100n,
        })
      }),
      getBlock: vi.fn(() =>
        Promise.resolve({
          number: 100n,
          timestamp: BigInt(Math.floor(Date.now() / 1000) - 3600), // 1 hour ago
        })
      ),
      getBlockNumber: vi.fn(() => Promise.resolve(100n)),
      getLogs: vi.fn(() => Promise.resolve([
        {
          transactionHash: '0xtest123',
          blockNumber: 100n,
        }
      ])),
      getBalance: vi.fn(() => Promise.resolve(BigInt(5e18))), // 5 ETH
      readContract: vi.fn(() => Promise.resolve(95n)), // Last block reported
    })),
    decodeFunctionData: vi.fn(() => ({
      args: [
        0n, // sequenceNumber
        '0x00' + '0'.repeat(100), // data starting with 0x00 (normally would trigger alert)
        0n, // afterDelayedMessagesRead
        '0x0000000000000000000000000000000000000000', // gasRefunder
        0n, // prevMessageCount
        0n, // newMessageCount
      ],
    })),
  }
})

// Set up test ignore configuration with function selectors
const testIgnoreList = {
  999001: ['0xasdf1234'],
}

beforeAll(() => {
  setIgnoreList(testIgnoreList)
})

describe('Ignore System', () => {
  test('should return true for configured function selectors', () => {
    // Test Chain 1 - multiSend ignored
    expect(shouldIgnoreFunctionSelector(999001, '0xasdf1234')).toBe(true)
    expect(shouldIgnoreFunctionSelector(999001, '0x12345678')).toBe(false)

    // Unknown chain should return false
    expect(shouldIgnoreFunctionSelector(999999, '0xasdf1234')).toBe(false)
  })

  test('should not alert for ignored chain in full batch poster check', async () => {
    // Dynamic import to ensure mocks are applied
    const { checkIfAnyTrustRevertedToPostDataOnChain } = await import('../index')
    
    const mockParentChainClient = {
      getTransaction: vi.fn().mockResolvedValue({
        hash: '0xtest123',
        from: '0xBatchPoster000000000000000000000000000001',
        input: '0xasdf1234' + '0'.repeat(200), // Ignored function selector
        blockNumber: 100n,
      }),
    }

    const testChainInfo = createTestChainConfig({
      chainId: 999001, // Chain with ignored function selector
      name: 'Ignored Test Chain',
    })

    const lastSequencerInboxLog = {
      transactionHash: '0xtest123',
      blockNumber: 100n,
    }

    // Run the check
    const alerts = await checkIfAnyTrustRevertedToPostDataOnChain({
      parentChainClient: mockParentChainClient as any,
      childChainInformation: testChainInfo,
      lastSequencerInboxLog: lastSequencerInboxLog as any,
    })

    // Should return empty alerts array since function selector is ignored
    expect(alerts).toEqual([])
    expect(mockParentChainClient.getTransaction).toHaveBeenCalledWith({
      hash: '0xtest123',
    })
  })

  test('should alert for non-ignored chain with same conditions', async () => {
    // Dynamic import to ensure mocks are applied
    const { checkIfAnyTrustRevertedToPostDataOnChain } = await import('../index')
    
    const mockParentChainClient = {
      getTransaction: vi.fn().mockResolvedValue({
        hash: '0xtest456',
        from: '0xBatchPoster000000000000000000000000000001',
        input: '0x12345678' + '0'.repeat(200), // Non-ignored function selector
        blockNumber: 100n,
      }),
    }

    const testChainInfo = createTestChainConfig({
      chainId: 999002, // Different chain without ignore config
      name: 'Non-Ignored Test Chain',
    })

    const lastSequencerInboxLog = {
      transactionHash: '0xtest456',
      blockNumber: 100n,
    }

    // Mock decodeFunctionData for non-ignored transaction
    vi.mocked(await import('viem')).decodeFunctionData.mockReturnValue({
      args: [
        0n,
        '0x00' + '0'.repeat(100), // data starting with 0x00 (should trigger alert)
        0n,
        '0x0000000000000000000000000000000000000000',
        0n,
        0n,
      ],
    })

    // Run the check
    const alerts = await checkIfAnyTrustRevertedToPostDataOnChain({
      parentChainClient: mockParentChainClient as any,
      childChainInformation: testChainInfo,
      lastSequencerInboxLog: lastSequencerInboxLog as any,
    })

    // Should return alert since function selector is NOT ignored
    expect(alerts.length).toBe(1)
    expect(alerts[0]).toContain('AnyTrust chain [Non-Ignored Test Chain] has fallen back')
  })
})
