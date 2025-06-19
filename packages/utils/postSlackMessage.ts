import { WebClient } from '@slack/web-api'
import { sanitizeSlackMessage } from './sanitizeSlackMessage'
import { formatGitHubCIInfo } from './githubCIUtils'

export const postSlackMessage = ({
  slackToken,
  slackChannel,
  message,
}: {
  slackToken: string
  slackChannel: string
  message: string
}) => {
  const web = new WebClient(slackToken)

  // Append GitHub CI run information if available
  const ciInfo = formatGitHubCIInfo()
  const messageWithCIInfo = ciInfo ? `${message}\n\n${ciInfo}` : message

  console.log(`>>> Posting message to Slack -> ${messageWithCIInfo}`)

  return web.chat.postMessage({
    text: sanitizeSlackMessage(messageWithCIInfo),
    channel: slackChannel,
    unfurl_links: false,
  })
}
