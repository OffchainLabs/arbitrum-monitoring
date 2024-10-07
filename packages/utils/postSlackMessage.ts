import { WebClient } from '@slack/web-api'
import { sanitizeSlackMessage } from './sanitizeSlackMessage'

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

  console.log(`>>> Posting message to Slack -> ${message}`)

  return web.chat.postMessage({
    text: sanitizeSlackMessage(message),
    channel: slackChannel,
    unfurl_links: false,
  })
}
