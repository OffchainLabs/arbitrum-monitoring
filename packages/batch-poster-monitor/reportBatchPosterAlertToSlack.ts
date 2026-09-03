import { createSlackPoster } from 'utils'

export const reportBatchPosterErrorToSlack = createSlackPoster({
  webhookUrlEnvVar: 'BATCH_POSTER_MONITORING_SLACK_WEBHOOK_URL',
  tokenEnvVar: 'BATCH_POSTER_MONITORING_SLACK_TOKEN',
  channelEnvVar: 'BATCH_POSTER_MONITORING_SLACK_CHANNEL',
})
