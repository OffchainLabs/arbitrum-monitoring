import { createSlackPoster } from 'utils'

export const reportArbosVersionAlertToSlack = createSlackPoster({
  tokenEnvVar: 'ARBOS_VERSION_MONITORING_SLACK_TOKEN',
  channelEnvVar: 'ARBOS_VERSION_MONITORING_SLACK_CHANNEL',
})
