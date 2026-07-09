import { describe, expect, test, vi } from 'vitest'
import { isTransientRpcError, withRetry } from '../index'

// mirrors the error shape viem builds for an Alchemy 429 (HttpRequestError
// wrapped in a ContractFunctionExecutionError)
const alchemy429 = () => {
  const httpError = new Error(
    'HTTP request failed.\n\nStatus: 429\nURL: https://eth-mainnet.g.alchemy.com/v2/xxx'
  ) as Error & { status: number; details: string }
  httpError.status = 429
  httpError.details =
    '{"code":429,"message":"Your app has exceeded its compute units per second capacity."}'
  const wrapped = new Error('HTTP request failed.') as Error & { cause: Error }
  wrapped.cause = httpError
  return wrapped
}

describe('isTransientRpcError', () => {
  test('detects 429 status on the error or its cause chain', () => {
    expect(isTransientRpcError(alchemy429())).toBe(true)
    expect(isTransientRpcError((alchemy429() as any).cause)).toBe(true)
  })

  test('detects transient errors from message text', () => {
    expect(isTransientRpcError(new Error('Status: 429'))).toBe(true)
    expect(isTransientRpcError(new Error('rate limit exceeded'))).toBe(true)
    expect(
      isTransientRpcError(
        new Error('exceeded its compute units per second capacity')
      )
    ).toBe(true)
    expect(isTransientRpcError(new Error('The request timed out.'))).toBe(true)
    expect(isTransientRpcError(new Error('fetch failed'))).toBe(true)
    expect(isTransientRpcError(new Error('502 Bad Gateway'))).toBe(true)
  })

  test('does not flag genuine chain/contract errors', () => {
    expect(
      isTransientRpcError(new Error('Batch poster information not found'))
    ).toBe(false)
    expect(
      isTransientRpcError(
        new Error(
          '[isAnyTrust] failed to decode input data for transaction 0x7982d3d9'
        )
      )
    ).toBe(false)
    expect(isTransientRpcError(new Error('execution reverted'))).toBe(false)
    expect(isTransientRpcError(undefined)).toBe(false)
  })

  test('handles non-Error throws', () => {
    expect(isTransientRpcError('rate limit exceeded')).toBe(true)
    expect(isTransientRpcError('something else broke')).toBe(false)
    expect(isTransientRpcError(42)).toBe(false)
  })
})

describe('withRetry', () => {
  test('retries transient errors and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(alchemy429())
      .mockRejectedValueOnce(alchemy429())
      .mockResolvedValue('ok')

    const result = await withRetry(fn, { retries: 3, initialDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  test('rethrows immediately on non-transient errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error('Batch poster information not found'))

    await expect(
      withRetry(fn, { retries: 3, initialDelayMs: 1 })
    ).rejects.toThrow('Batch poster information not found')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('gives up after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(alchemy429())

    await expect(
      withRetry(fn, { retries: 2, initialDelayMs: 1 })
    ).rejects.toThrow('HTTP request failed.')
    expect(fn).toHaveBeenCalledTimes(3) // initial attempt + 2 retries
  })
})
