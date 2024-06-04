import { WebClient } from '@slack/web-api'
import dotenv from 'dotenv'
dotenv.config()

const slackToken = process.env.ORBIT_RETRYABLE_MONITORING_SLACK_TOKEN
const slackChannel =
  process.env.ORBIT_RETRYABLE_MONITORING_SLACK_CHANNEL || 'C02R00X0HLN'

const web = new WebClient(slackToken)
export const slackMessageRetryablesMonitor = (text: string) => {
  console.log()
  console.log(text)
  console.log()

  if (process.env.NODE_ENV === 'DEV') return
  if (process.env.NODE_ENV === 'CI' && text === 'success') return

  return web.chat.postMessage({
    text,
    channel: slackChannel,
    unfurl_links: false,
  })
}
