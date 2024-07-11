import dotenv from 'dotenv'
import { postSlackMessage } from '../utils/postSlackMessage'

dotenv.config()

const slackToken = process.env.RETRYABLE_MONITORING_SLACK_TOKEN
const slackChannel = process.env.RETRYABLE_MONITORING_SLACK_CHANNEL

export const reportRetryableErrorToSlack = ({
  message,
}: {
  message: string
}) => {
  if (!slackToken) throw new Error(`Slack token is required.`)
  if (!slackChannel) throw new Error(`Slack channel is required.`)

  if (process.env.NODE_ENV === 'DEV') return
  if (process.env.NODE_ENV === 'CI' && message === 'success') return

  postSlackMessage({
    slackToken,
    slackChannel,
    message,
  })
}
