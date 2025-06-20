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

export const postSlackBlocks = ({
  slackToken,
  slackChannel,
  blocks,
  text = 'New notification',
}: {
  slackToken: string
  slackChannel: string
  blocks: any[]
  text?: string
}) => {
  const web = new WebClient(slackToken)

  console.log(
    `>>> Posting blocks to Slack -> ${JSON.stringify(blocks, null, 2)}`
  )

  return web.chat.postMessage({
    text: text, // Fallback text for notifications
    channel: slackChannel,
    blocks: blocks,
    unfurl_links: false,
  })
}
