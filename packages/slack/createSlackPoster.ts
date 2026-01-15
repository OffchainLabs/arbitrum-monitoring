import { postSlackMessage } from './postSlackMessage'

export const createSlackPoster = ({
  tokenEnvVar,
  channelEnvVar,
}: {
  tokenEnvVar: string
  channelEnvVar: string
}) => {
  return ({ message }: { message: string }) => {
    const slackToken = process.env[tokenEnvVar]
    const slackChannel = process.env[channelEnvVar]

    if (!slackToken) throw new Error('Slack token is required.')
    if (!slackChannel) throw new Error('Slack channel is required.')

    if (process.env.NODE_ENV === 'DEV') return
    if (process.env.NODE_ENV === 'CI' && message === 'success') return

    return postSlackMessage({
      slackToken,
      slackChannel,
      message,
    })
  }
}
