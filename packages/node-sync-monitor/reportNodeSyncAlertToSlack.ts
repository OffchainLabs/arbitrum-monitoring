import { createSlackPoster } from 'utils'

export const reportNodeSyncAlertToSlack = createSlackPoster({
  tokenEnvVar: 'NODE_SYNC_MONITORING_SLACK_TOKEN',
  channelEnvVar: 'NODE_SYNC_MONITORING_SLACK_CHANNEL',
})
