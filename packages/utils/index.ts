export * from './types'
export * from './config'
export { getExplorerUrlPrefixes } from './getExplorerUrlPrefixes'
export { postSlackMessage } from './postSlackMessage'
export { createSlackPoster } from './createSlackPoster'

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))
