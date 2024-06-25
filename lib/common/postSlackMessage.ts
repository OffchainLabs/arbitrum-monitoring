import { WebClient } from '@slack/web-api'
import dotenv from 'dotenv'
dotenv.config()

export const postSlackMessage = ({
  slackTokenEnvKey,
  slackChannelEnvKey,
  message,
}: {
  slackTokenEnvKey: string
  slackChannelEnvKey: string
  message: string
}) => {
  const slackToken = process.env[slackTokenEnvKey]
  const slackChannel = process.env[slackChannelEnvKey]

  if (!slackToken) throw new Error(`Slack token is required.`)
  if (!slackChannel) throw new Error(`Slack channel is required.`)

  const web = new WebClient(slackToken)
  if (process.env.NODE_ENV === 'DEV') return
  if (process.env.NODE_ENV === 'CI' && message === 'success') return

  console.log(`>>> Posting message to Slack -> ${message}`)

  return web.chat.postMessage({
    text: message,
    channel: slackChannel,
    unfurl_links: false,
  })
}
