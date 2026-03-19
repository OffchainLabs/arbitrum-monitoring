export * from './types'
export * from './config'
export { getExplorerUrlPrefixes } from './getExplorerUrlPrefixes'
export { postSlackMessage } from './postSlackMessage'
export { createSlackPoster } from './createSlackPoster'
export { parseAmount } from './amountUtils'

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))

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
