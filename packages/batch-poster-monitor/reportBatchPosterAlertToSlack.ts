import { createSlackPoster } from '@arbitrum-monitoring/slack'

export const reportBatchPosterErrorToSlack = createSlackPoster({
  tokenEnvVar: 'BATCH_POSTER_MONITORING_SLACK_TOKEN',
  channelEnvVar: 'BATCH_POSTER_MONITORING_SLACK_CHANNEL',
})
