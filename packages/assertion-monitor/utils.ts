import { AssertionDataError } from './errors'

export const jsonStringifyWithBigInt = (obj: any): string =>
  JSON.stringify(
    obj,
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
    2
  )

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
