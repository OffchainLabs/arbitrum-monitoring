import { createSlackPoster } from 'utils'

export const reportAssertionMonitorErrorToSlack = createSlackPoster({
  webhookUrlEnvVar: 'ASSERTION_MONITORING_SLACK_WEBHOOK_URL',
  tokenEnvVar: 'ASSERTION_MONITORING_SLACK_TOKEN',
  channelEnvVar: 'ASSERTION_MONITORING_SLACK_CHANNEL',
})
