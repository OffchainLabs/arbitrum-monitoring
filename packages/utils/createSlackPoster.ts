import { postSlackMessage } from './postSlackMessage'
import { postSlackMessageViaWebhook } from './postSlackMessageViaWebhook'

export const createSlackPoster = ({
  tokenEnvVar,
  channelEnvVar,
  webhookUrlEnvVar,
}: {
  tokenEnvVar: string
  channelEnvVar: string
  webhookUrlEnvVar?: string
}) => {
  return ({ message }: { message: string }) => {
    const slackWebhookUrl = webhookUrlEnvVar
      ? process.env[webhookUrlEnvVar]
      : undefined
    const slackToken = process.env[tokenEnvVar]
    const slackChannel = process.env[channelEnvVar]

    if (!slackWebhookUrl && !(slackToken && slackChannel)) {
      if (webhookUrlEnvVar) {
        throw new Error(
          `Slack configuration is required: set ${webhookUrlEnvVar} (preferred) or both ${tokenEnvVar} and ${channelEnvVar}.`
        )
      }
      if (!slackToken) throw new Error('Slack token is required.')
      throw new Error('Slack channel is required.')
    }

    if (process.env.NODE_ENV === 'DEV') return
    if (process.env.NODE_ENV === 'CI' && message === 'success') return

    if (slackWebhookUrl) {
      return postSlackMessageViaWebhook({
        webhookUrl: slackWebhookUrl,
        message,
      })
    }

    return postSlackMessage({
      slackToken: slackToken as string,
      slackChannel: slackChannel as string,
      message,
    })
  }
}
