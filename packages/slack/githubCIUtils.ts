/**
 * Formats GitHub CI information as a markdown link for notifications
 * Returns undefined if not running in GitHub Actions
 */
export const formatGitHubCIInfo = (): string | undefined => {
  const repository = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID

  if (!repository || !runId) {
    return undefined
  }

  const runUrl = `https://github.com/${repository}/actions/runs/${runId}`
  return `[Message Source](${runUrl})`
}

/**
 * Checks if the current environment is GitHub Actions
 */
export const isGitHubActions = (): boolean => {
  return !!(process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID)
}
