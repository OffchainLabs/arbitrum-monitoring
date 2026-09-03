export * from './types'
export * from './config'
export { getExplorerUrlPrefixes } from './getExplorerUrlPrefixes'
export { postSlackMessage } from './postSlackMessage'
export { postSlackMessageViaWebhook } from './postSlackMessageViaWebhook'
export { createSlackPoster } from './createSlackPoster'
export { parseAmount } from './amountUtils'
export { resolveRollupAddress } from './resolveRollupAddress'

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const TRANSIENT_RPC_ERROR_REGEX =
  /status: 429|rate limit|too many requests|compute units|timed? ?out|econnreset|econnrefused|socket hang up|fetch failed|service unavailable|bad gateway|gateway time-?out/i

/**
 * Returns true for retryable RPC-infra failures (rate limits, timeouts,
 * gateway/network errors), as opposed to genuine chain/contract errors.
 */
export const isTransientRpcError = (error: unknown): boolean => {
  // viem wraps the underlying HttpRequestError, so walk the cause chain
  let current: unknown = error
  for (let depth = 0; current != null && depth < 10; depth++) {
    if (typeof current !== 'object') {
      return TRANSIENT_RPC_ERROR_REGEX.test(String(current))
    }
    const candidate = current as {
      status?: unknown
      message?: unknown
      details?: unknown
      cause?: unknown
    }
    if (
      candidate.status === 429 ||
      (typeof candidate.status === 'number' && candidate.status >= 500)
    ) {
      return true
    }
    if (
      TRANSIENT_RPC_ERROR_REGEX.test(
        `${candidate.message ?? ''} ${candidate.details ?? ''}`
      )
    ) {
      return true
    }
    current = candidate.cause
  }
  return false
}

/**
 * Retries `fn` with exponential backoff on transient RPC errors;
 * other errors are rethrown immediately.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options?: { retries?: number; initialDelayMs?: number; label?: string }
): Promise<T> => {
  const retries = options?.retries ?? 3
  const initialDelayMs = options?.initialDelayMs ?? 2000
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= retries || !isTransientRpcError(error)) {
        throw error
      }
      const delayMs = initialDelayMs * 2 ** attempt
      console.warn(
        `${
          options?.label ?? 'RPC call'
        } failed with a transient error, retrying in ${
          delayMs / 1000
        }s (attempt ${attempt + 1}/${retries})`
      )
      await sleep(delayMs)
    }
  }
}

/**
 * Processes a block range in chunks, halving chunk size on failure and retrying.
 */
export const processBlockRangeInChunks = async <T>(
  fromBlock: number,
  toBlock: number,
  chunkSize: number,
  fn: (from: number, to: number) => Promise<T>,
  combine: (prev: T, next: T) => T,
  initial: T,
  options?: {
    minChunkSize?: number
    reverse?: boolean
    stopWhen?: (result: T) => boolean
  }
): Promise<T> => {
  const minChunkSize = options?.minChunkSize ?? 500
  let result = initial

  const ranges: [number, number][] = []
  for (let i = fromBlock; i <= toBlock; i += chunkSize) {
    ranges.push([i, Math.min(i + chunkSize - 1, toBlock)])
  }
  if (options?.reverse) ranges.reverse()

  for (const [rangeFrom, rangeTo] of ranges) {
    try {
      const chunkResult = await fn(rangeFrom, rangeTo)
      result = combine(result, chunkResult)
      if (options?.stopWhen?.(result)) return result
      await sleep(100)
    } catch (error) {
      if (chunkSize > minChunkSize) {
        const smallerChunk = Math.floor(chunkSize / 2)
        console.warn(
          `Block range [${rangeFrom}-${rangeTo}] failed, retrying with chunk size ${smallerChunk}`
        )
        const chunkResult = await processBlockRangeInChunks(
          rangeFrom,
          rangeTo,
          smallerChunk,
          fn,
          combine,
          initial,
          { ...options, minChunkSize }
        )
        result = combine(result, chunkResult)
        if (options?.stopWhen?.(result)) return result
      } else {
        throw error
      }
    }
  }

  return result
}
