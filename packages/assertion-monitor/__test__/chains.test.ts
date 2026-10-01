import { describe, expect, test } from 'vitest'
import { arbitrum, base, mainnet } from 'viem/chains'
import {
  getChainFromId,
  getConfirmPeriodSeconds,
  getLogChunkSizeForChain,
  getRollupBlockTimeForChain,
} from '../chains'
import { CHUNK_SIZE } from '../constants'

describe('getRollupBlockTimeForChain', () => {
  test('uses the L1 block time for Arbitrum parent chains', () => {
    expect(getRollupBlockTimeForChain(arbitrum)).toBe(12)
  })

  test('uses the parent block time for other parent chains', () => {
    expect(getRollupBlockTimeForChain(mainnet)).toBe(12)
    expect(getRollupBlockTimeForChain(base)).toBe(2)
  })
})

describe('getLogChunkSizeForChain', () => {
  test('scales chunk size with parent block speed', () => {
    expect(getLogChunkSizeForChain(mainnet)).toBe(CHUNK_SIZE)
    expect(getLogChunkSizeForChain(base)).toBe(CHUNK_SIZE * 6n)
    expect(getLogChunkSizeForChain(arbitrum)).toBe(CHUNK_SIZE * 48n)
  })
})

describe('getChainFromId', () => {
  test('throws on an unsupported parent chain id', () => {
    expect(() => getChainFromId(999999)).toThrow('Unsupported parent chain id')
  })
})

describe('getConfirmPeriodSeconds', () => {
  test('counts confirm period blocks at L1 speed on Arbitrum parent chains', () => {
    expect(
      getConfirmPeriodSeconds({
        parentChainId: arbitrum.id,
        confirmPeriodBlocks: 45818,
      } as any)
    ).toBe(45818 * 12)
  })
})
