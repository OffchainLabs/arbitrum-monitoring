import { createSlackPoster } from '@arbitrum-monitoring/slack'

export const reportAssertionMonitorErrorToSlack = createSlackPoster({
  tokenEnvVar: 'ASSERTION_MONITORING_SLACK_TOKEN',
  channelEnvVar: 'ASSERTION_MONITORING_SLACK_CHANNEL',
})
