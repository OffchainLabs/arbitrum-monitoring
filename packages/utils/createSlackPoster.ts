import { postSlackMessage } from './postSlackMessage'

export const createSlackPoster = ({
  tokenEnvVar,
  channelEnvVar,
}: {
  tokenEnvVar: string
  channelEnvVar: string
}) => {
  return ({ message }: { message: string }) => {
    // In CI mode, output the message with markers for extraction (skip actual posting)
    if (process.env.NODE_ENV === 'CI') {
      if (message !== 'success') {
        console.log('[SLACK_MESSAGE_START]')
        console.log(message)
        console.log('[SLACK_MESSAGE_END]')
      }
      return
    }

    const slackToken = process.env[tokenEnvVar]
    const slackChannel = process.env[channelEnvVar]

    if (!slackToken) throw new Error('Slack token is required.')
    if (!slackChannel) throw new Error('Slack channel is required.')

    if (process.env.NODE_ENV === 'DEV') return

    return postSlackMessage({
      slackToken,
      slackChannel,
      message,
    })
  }
}
