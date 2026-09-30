import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { checkRetryables } = vi.hoisted(() => ({
  checkRetryables: vi.fn(),
}))

vi.mock('../core/retryableChecker', () => ({ checkRetryables }))

import {
  checkRetryablesContinuous,
  checkRetryablesOneOff,
} from '../core/retryableCheckerMode'

const childChain = {
  chainId: 42161,
  parentChainId: 1,
  ethBridge: { bridge: '0xbridge' },
} as any

const callbacks = {
  onFailedRetryableFound: vi.fn(),
  onRedeemedRetryableFound: vi.fn(),
}

describe('retryable checker mode RPC retries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkRetryables.mockResolvedValue(false)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb()
      return 0 as unknown as NodeJS.Timeout
    }) as typeof setTimeout)
  })

  afterEach(() => vi.restoreAllMocks())

  test('retries the initial latest-block lookup', async () => {
    const getBlockNumber = vi
      .fn()
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValue(25)

    await expect(
      checkRetryablesOneOff({
        parentChainProvider: { getBlockNumber } as any,
        childChainProvider: {} as any,
        childChain,
        fromBlock: 1,
        toBlock: 0,
        enableAlerting: false,
        ...callbacks,
      })
    ).resolves.toBe(25)

    expect(getBlockNumber).toHaveBeenCalledTimes(2)
  })

  test('retries the latest-block lookup between continuous scans', async () => {
    const getBlockNumber = vi
      .fn()
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValue(2)
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(181_000)

    await checkRetryablesContinuous({
      parentChainProvider: { getBlockNumber } as any,
      childChainProvider: {} as any,
      childChain,
      fromBlock: 1,
      toBlock: 2,
      enableAlerting: false,
      continuous: true,
      ...callbacks,
    })

    expect(getBlockNumber).toHaveBeenCalledTimes(2)
  })
})
