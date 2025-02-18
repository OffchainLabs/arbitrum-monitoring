import { AssertionLogs } from './types'
import { AssertionDataError } from './errors'

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

export function extractBoldBlockHash(assertionData: any): `0x${string}` {
  if (!assertionData?.[2]?.[0]?.globalStateBytes32Vals?.[0]) {
    throw new AssertionDataError(
      'Incomplete BOLD assertion data structure',
      assertionData
    )
  }
  return assertionData[2][0].globalStateBytes32Vals[0]
}

export function extractClassicBlockHash(assertionData: any): `0x${string}` {
  if (!assertionData?.afterState?.globalState?.bytes32Vals?.[0]) {
    throw new AssertionDataError(
      'Incomplete Classic assertion data structure',
      assertionData
    )
  }
  return assertionData.afterState.globalState.bytes32Vals[0]
}
