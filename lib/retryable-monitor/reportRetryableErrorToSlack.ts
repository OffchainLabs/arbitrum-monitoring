import dotenv from 'dotenv'
import { postSlackMessage } from '../../common/postSlackMessage'

dotenv.config()

const slackToken = process.env.RETRYABLE_MONITOR_SLACK_TOKEN_ENV_KEY
const slackChannel = process.env.RETRYABLE_MONITOR_SLACK_CHANNEL_ENV_KEY

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
