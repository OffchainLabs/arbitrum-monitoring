import { sanitizeSlackMessage } from './sanitizeSlackMessage'
import { formatGitHubCIInfo } from './githubCIUtils'

export const postSlackMessageViaWebhook = async ({
  webhookUrl,
  message,
}: {
  webhookUrl: string
  message: string
}) => {
  // Append GitHub CI run information if available
  const ciInfo = formatGitHubCIInfo()
  const messageWithCIInfo = ciInfo ? `${message}\n\n${ciInfo}` : message

  console.log(`>>> Posting message to Slack (webhook) -> ${messageWithCIInfo}`)

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: sanitizeSlackMessage(messageWithCIInfo),
      unfurl_links: false,
    }),
  })

  if (!response.ok) {
    // never include the webhook URL itself in errors, it is a secret
    throw new Error(
      `Failed to post Slack message via webhook: ${
        response.status
      } ${await response.text()}`
    )
  }

  return response
}
