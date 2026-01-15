import { postSlackMessage as commonPostSlackMessage } from '../../../utils/postSlackMessage'

const slackToken = process.env.RETRYABLE_MONITORING_SLACK_TOKEN
const slackChannel = process.env.RETRYABLE_MONITORING_SLACK_CHANNEL

export const postSlackMessage = ({ message }: { message: string }) => {
  if (!slackToken) throw new Error(`Slack token is required.`)
  if (!slackChannel) throw new Error(`Slack channel is required.`)

  if (process.env.NODE_ENV === 'DEV') return
  if (process.env.NODE_ENV === 'CI' && message === 'success') return

  commonPostSlackMessage({
    slackToken,
    slackChannel,
    message,
  })
}
