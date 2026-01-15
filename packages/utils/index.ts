export * from './types'
export * from './config'
export { getExplorerUrlPrefixes } from './getExplorerUrlPrefixes'
export { formatGitHubCIInfo, isGitHubActions } from './githubCIUtils'

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))
