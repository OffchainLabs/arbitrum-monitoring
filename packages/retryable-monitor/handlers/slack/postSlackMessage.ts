import { createSlackPoster } from '@arbitrum-monitoring/slack'

export const postSlackMessage = createSlackPoster({
  tokenEnvVar: 'RETRYABLE_MONITORING_SLACK_TOKEN',
  channelEnvVar: 'RETRYABLE_MONITORING_SLACK_CHANNEL',
})
