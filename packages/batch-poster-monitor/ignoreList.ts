// Default ignore list configuration - maps chainId to function selectors or 'all' for entire chain
const defaultIgnoreList: Record<number, string[]> = {
  51828: ['0x8d80ff0a'], // ChainBounty - multiSend(bytes)
  98867: ['all'], // Plume testnet - ignore entire chain
  383353: ['all'], // Cheese Chain - ignore entire chain
  668668: ['all'], // Conwai - ignore entire chain
  2730: ['all'], // XR Sepolia - ignore entire chain
}

let ignoreList: Record<number, string[]> = defaultIgnoreList

export const shouldIgnoreFunctionSelector = (
  chainId: number,
  functionSelector: string
): boolean => {
  return (
    ignoreList[chainId]?.includes(functionSelector) ||
    ignoreList[chainId]?.includes('all') ||
    false
  )
}

export const shouldIgnoreChain = (chainId: number): boolean => {
  return shouldIgnoreFunctionSelector(chainId, 'all')
}

// Helper to check if an error is due to an ignored function selector
export const isIgnoredSelectorError = (
  error: any,
  chainId: number
): { isIgnored: boolean; selector?: string } => {
  if (!error?.message) {
    return { isIgnored: false }
  }

  // Extract function selector from error message
  const selectorMatch = error.message.match(/0x[a-fA-F0-9]{8}/)
  if (!selectorMatch) {
    return { isIgnored: false }
  }

  const selector = selectorMatch[0]
  const isIgnored = shouldIgnoreFunctionSelector(chainId, selector)

  return { isIgnored, selector }
}

// Function to set custom ignore list (mainly for testing)
export const setIgnoreList = (customIgnoreList: Record<number, string[]>) => {
  ignoreList = customIgnoreList
}
