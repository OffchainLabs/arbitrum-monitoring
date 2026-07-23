import { createSlackPoster } from 'utils'

export const postSlackMessage = createSlackPoster({
  webhookUrlEnvVar: 'RETRYABLE_MONITORING_SLACK_WEBHOOK_URL',
  tokenEnvVar: 'RETRYABLE_MONITORING_SLACK_TOKEN',
  channelEnvVar: 'RETRYABLE_MONITORING_SLACK_CHANNEL',
})
