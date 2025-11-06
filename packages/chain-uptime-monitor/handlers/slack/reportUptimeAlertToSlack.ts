import { postSlackMessage } from '../../../utils'
import { ChainUptimeResult } from '../../core/types'

export const reportUptimeAlertToSlack = async ({
  result,
  slackToken,
  slackChannel,
}: {
  result: ChainUptimeResult
  slackToken?: string
  slackChannel?: string
}) => {
  if (!slackToken || !slackChannel) {
    console.warn('Slack token or channel not configured, skipping Slack alert')
    return
  }

  const message = result.isRunning
    ? `✅ Chain Uptime Check: ${result.chainName} (Chain ID: ${result.chainId}) is UP\n` +
      `Block Number: ${result.blockNumber}\n` +
      `Response Time: ${result.responseTime}ms\n` +
      `RPC URL: ${result.rpcUrl}`
    : `❌ Chain Uptime Alert: ${result.chainName} (Chain ID: ${result.chainId}) is DOWN\n` +
      `Error: ${result.error}\n` +
      `Response Time: ${result.responseTime}ms\n` +
      `RPC URL: ${result.rpcUrl}`

  await postSlackMessage({
    slackToken,
    slackChannel,
    message,
  })
}

