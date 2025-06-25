// Default ignore list configuration - maps chainId to function selectors
const defaultIgnoreList: Record<number, string[]> = {
  51828: ['0x8d80ff0a'], // ChainBounty - multiSend(bytes)
}

// Allow override for testing
let ignoreList: Record<number, string[]> = defaultIgnoreList

// Helper to check if a chain+function selector should be ignored
export const shouldIgnoreFunctionSelector = (
  chainId: number,
  functionSelector: string
): boolean => {
  return ignoreList[chainId]?.includes(functionSelector) || false
}

// Function to set custom ignore list (mainly for testing)
export const setIgnoreList = (customIgnoreList: Record<number, string[]>) => {
  ignoreList = customIgnoreList
}
