import { createSlackPoster } from 'utils'

export const postSlackMessage = createSlackPoster({
  tokenEnvVar: 'RETRYABLE_MONITORING_SLACK_TOKEN',
  channelEnvVar: 'RETRYABLE_MONITORING_SLACK_CHANNEL',
})
