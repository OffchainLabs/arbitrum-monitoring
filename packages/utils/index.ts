export * from './types'
export * from './config'
export { getExplorerUrlPrefixes } from './getExplorerUrlPrefixes'
export { postSlackMessage } from './postSlackMessage'
export { createSlackPoster } from './createSlackPoster'
export { parseAmount } from './amountUtils'
export { resolveRollupAddress } from './resolveRollupAddress'

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const TRANSIENT_RPC_ERROR_REGEX =
  /status[=: ]+(?:429|5\d\d)|rate limit|too many requests|compute units|timed? ?out|network[_ ]error|econnreset|econnrefused|eai_again|socket hang up|fetch failed|service unavailable|bad gateway|gateway time-?out/i

const RATE_LIMIT_RPC_ERROR_REGEX =
  /status[=: ]+429|rate limit|too many requests|compute units/i

const matchesRpcError = (
  error: unknown,
  isMatchingStatus: (status: number) => boolean,
  pattern: RegExp
): boolean => {
  // clients wrap transport errors under cause or error, sometimes both
  const pending: unknown[] = [error]
  for (let visited = 0; pending.length > 0 && visited < 50; visited++) {
    const current = pending.shift()
    if (typeof current !== 'object' || current === null) {
      if (pattern.test(String(current))) return true
      continue
    }
    const candidate = current as {
      status?: unknown
      statusCode?: unknown
      code?: unknown
      message?: unknown
      details?: unknown
      body?: unknown
      cause?: unknown
      error?: unknown
      response?: unknown
      serverError?: unknown
    }
    const status = Number(candidate.status ?? candidate.statusCode)
    if (Number.isFinite(status) && isMatchingStatus(status)) return true
    if (
      pattern.test(
        `${candidate.code ?? ''} ${candidate.message ?? ''} ${
          candidate.details ?? ''
        } ${candidate.body ?? ''}`
      )
    ) {
      return true
    }
    for (const child of [
      candidate.cause,
      candidate.error,
      candidate.response,
      candidate.serverError,
    ]) {
      if (child != null) pending.push(child)
    }
  }
  return false
}

/**
 * Returns true for retryable RPC-infra failures (rate limits, timeouts,
 * gateway/network errors), as opposed to genuine chain/contract errors.
 */
export const isTransientRpcError = (error: unknown): boolean =>
  matchesRpcError(
    error,
    status => status === 429 || status >= 500,
    TRANSIENT_RPC_ERROR_REGEX
  )

/**
 * Returns true only for throttling (429, rate limit, compute units). Timeouts
 * and gateway errors are excluded since they often mean the request was too big.
 */
export const isRateLimitRpcError = (error: unknown): boolean =>
  matchesRpcError(error, status => status === 429, RATE_LIMIT_RPC_ERROR_REGEX)

/**
 * Retries `fn` with exponential backoff on transient RPC errors;
 * other errors are rethrown immediately.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options?: {
    retries?: number
    initialDelayMs?: number
    maxDelayMs?: number
    label?: string
  }
): Promise<T> => {
  const retries = options?.retries ?? 3
  const initialDelayMs = options?.initialDelayMs ?? 2000
  const maxDelayMs = options?.maxDelayMs ?? 15_000
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= retries || !isTransientRpcError(error)) {
        throw error
      }
      const delayMs = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs)
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
    splitOnRateLimit?: boolean
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
      if (
        chunkSize > minChunkSize &&
        (options?.splitOnRateLimit !== false || !isRateLimitRpcError(error))
      ) {
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
