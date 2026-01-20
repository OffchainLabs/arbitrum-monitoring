export * from './types'
export * from './config'
export { getExplorerUrlPrefixes } from './getExplorerUrlPrefixes'
export { parseAmount } from './amountUtils'

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))
