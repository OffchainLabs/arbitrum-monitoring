import { describe, expect, test, vi } from 'vitest'
import type { PublicClient } from 'viem'
import { fetchConfirmableCreationEvent } from '../blockchain'

const chainInfo = {
  name: 'Test Chain',
  parentChainId: 1,
  confirmPeriodBlocks: 45818,
  ethBridge: { rollup: '0x1234567890123456789012345678901234567890' },
} as any

// 4h grace at 12s blocks
const GRACE_BLOCKS = 1200n

describe('fetchConfirmableCreationEvent', () => {
  test('searches one confirm period before the window, up to the confirm period plus grace before its end', async () => {
    const getLogs = vi.fn().mockResolvedValue([])
    const client = { getLogs } as unknown as PublicClient
    const fromBlock = 10_000_000n
    const toBlock = 10_050_400n

    await fetchConfirmableCreationEvent(
      fromBlock,
      toBlock,
      client,
      chainInfo,
      true,
      1_000_000n
    )

    const [{ fromBlock: searchFrom, toBlock: searchTo }] = getLogs.mock.calls[0]
    expect(searchFrom).toBe(fromBlock - 45818n)
    expect(searchTo).toBe(toBlock - 45818n - GRACE_BLOCKS)
  })

  test('returns null when the chain is younger than the confirm period', async () => {
    const getLogs = vi.fn()
    const client = { getLogs } as unknown as PublicClient

    expect(
      await fetchConfirmableCreationEvent(0n, 40_000n, client, chainInfo, true)
    ).toBeNull()
    expect(getLogs).not.toHaveBeenCalled()
  })
})
