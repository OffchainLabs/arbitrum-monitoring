import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { setIgnoreList, shouldIgnoreFunctionSelector, isIgnoredSelectorError, shouldIgnoreChain } from '../ignoreList'
import { createTestChainConfig } from './testConfigs'

const VIEM_DECODE_ERROR_MESSAGE = (selector: string) => 
  `Encoded function signature "${selector}" not found on ABI.\n` +
  `Make sure you are using the correct ABI and that the function exists on it.\n` +
  `You can look up the signature here: https://openchain.xyz/signatures?query=${selector}.\n\n` +
  `Docs: https://viem.sh/docs/contract/decodeFunctionData.html\n` +
  `Version: viem@1.20.0`

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem')
  return {
    ...actual,
    decodeFunctionData: vi.fn((params) => {
      const selector = params.data.slice(0, 10)
      if (selector === '0x8d80ff0a') {
        throw new Error(VIEM_DECODE_ERROR_MESSAGE('0x8d80ff0a'))
      }
      return {
        args: [0n, '0x00' + '0'.repeat(100), 0n, '0x0000000000000000000000000000000000000000', 0n, 0n]
      }
    }),
  }
})

beforeAll(() => {
  setIgnoreList({ 999001: ['0x8d80ff0a'] })
})

describe('Ignore List System', () => {
  test('should handle function selector ignoring correctly', () => {
    const testCases = [
      // shouldIgnoreFunctionSelector tests
      { fn: () => shouldIgnoreFunctionSelector(999001, '0x8d80ff0a'), expected: true },
      { fn: () => shouldIgnoreFunctionSelector(999001, '0x12345678'), expected: false },
      { fn: () => shouldIgnoreFunctionSelector(999002, '0x8d80ff0a'), expected: false },
      
      // isIgnoredSelectorError tests
      { fn: () => isIgnoredSelectorError(new Error(VIEM_DECODE_ERROR_MESSAGE('0x8d80ff0a')), 999001), 
        expected: { isIgnored: true, selector: '0x8d80ff0a' } },
      { fn: () => isIgnoredSelectorError(new Error('Other error'), 999001), 
        expected: { isIgnored: false, selector: undefined } },
    ]
    
    testCases.forEach(({ fn, expected }) => {
      const result = fn()
      if (typeof expected === 'object') {
        expect(result).toEqual(expected)
      } else {
        expect(result).toBe(expected)
      }
    })
  })

  test('checkIfAnyTrustRevertedToPostDataOnChain should skip ignored selectors', async () => {
    const { checkIfAnyTrustRevertedToPostDataOnChain } = await import('../index')
    
    const mockClient = {
      getTransaction: vi.fn().mockResolvedValue({
        input: '0x8d80ff0a' + '0'.repeat(200),
      }),
    }
    
    const alerts = await checkIfAnyTrustRevertedToPostDataOnChain({
      parentChainClient: mockClient as any,
      childChainInformation: createTestChainConfig({ chainId: 999001 }),
      lastSequencerInboxLog: { transactionHash: '0xtest' } as any,
    })
    
    expect(alerts).toEqual([])
  })
})

describe('Chain-level Ignore with "all"', () => {
  beforeEach(() => {
    setIgnoreList({})
  })

  test('should ignore entire chains configured with "all"', () => {
    setIgnoreList({
      12345: ['all'],
      67890: ['0x12345678'],
    })
    
    expect(shouldIgnoreChain(12345)).toBe(true)   // Has 'all'
    expect(shouldIgnoreChain(67890)).toBe(false)  // Doesn't have 'all'
    expect(shouldIgnoreFunctionSelector(12345, 'any-selector')).toBe(true)  // Any selector ignored
  })

  test('should work alongside function selector ignores', () => {
    setIgnoreList({
      42161: ['0x8d80ff0a'],  // Function selector only
      421614: ['all'],        // Entire chain
    })
    
    expect(shouldIgnoreChain(42161)).toBe(false)
    expect(shouldIgnoreFunctionSelector(42161, '0x8d80ff0a')).toBe(true)
    expect(shouldIgnoreFunctionSelector(42161, '0xother')).toBe(false)
    
    expect(shouldIgnoreChain(421614)).toBe(true)
    expect(shouldIgnoreFunctionSelector(421614, 'any-selector')).toBe(true)
  })
})
