import { createSlackPoster } from 'slack'

export const reportAssertionMonitorErrorToSlack = createSlackPoster({
  tokenEnvVar: 'ASSERTION_MONITORING_SLACK_TOKEN',
  channelEnvVar: 'ASSERTION_MONITORING_SLACK_CHANNEL',
})
