export * from './types'
export { postSlackMessage } from './postSlackMessage'
export { getExplorerUrlPrefixes } from './getExplorerUrlPrefixes'

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))
