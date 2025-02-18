import { AssertionLogs } from './types'

export const jsonStringifyWithBigInt = (obj: any): string =>
  JSON.stringify(
    obj,
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
    2
  )

export function sortAndMergeAssertionLogs(logsArray: (AssertionLogs | undefined)[]): AssertionLogs {
  const initialValue: AssertionLogs = { createdLogs: [], confirmedLogs: [] }
  
  return logsArray.reduce(
    (acc: AssertionLogs, curr) => {
      if (!curr) return acc
      return {
        createdLogs: [...acc.createdLogs, ...(curr.createdLogs || [])].sort(
          (a, b) => {
            // First sort by block number
            if (a.blockNumber !== b.blockNumber) {
              return Number(a.blockNumber - b.blockNumber)
            }
            // Then by log index within the block
            return Number(a.logIndex - b.logIndex)
          }
        ),
        confirmedLogs: [
          ...acc.confirmedLogs,
          ...(curr.confirmedLogs || []),
        ].sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) {
            return Number(a.blockNumber - b.blockNumber)
          }
          return Number(a.logIndex - b.logIndex)
        }),
      }
    },
    initialValue
  )
} 