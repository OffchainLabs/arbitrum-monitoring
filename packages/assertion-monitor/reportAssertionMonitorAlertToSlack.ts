import { createSlackPoster } from 'utils'

export const reportAssertionMonitorErrorToSlack = createSlackPoster({
  tokenEnvVar: 'ASSERTION_MONITORING_SLACK_TOKEN',
  channelEnvVar: 'ASSERTION_MONITORING_SLACK_CHANNEL',
})
