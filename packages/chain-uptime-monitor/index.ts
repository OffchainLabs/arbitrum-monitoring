import yargs from 'yargs'
import {
  ChildNetwork,
  DEFAULT_CONFIG_PATH,
  getConfig,
  postSlackMessage,
} from '../utils'
import { ChainUptimeConfig, ChainUptimeResult } from './core/types'
import { isChainRunning } from './core/uptimeChecker'
import { reportUptimeAlertToSlack } from './handlers/slack/reportUptimeAlertToSlack'

interface ChainUptimeMonitorOptions {
  configPath: string
  enableAlerting: boolean
  consolidateAlerts: boolean
}

const parseOptions = (): ChainUptimeMonitorOptions => {
  return yargs(process.argv.slice(2))
    .options({
      configPath: { type: 'string', default: DEFAULT_CONFIG_PATH },
      enableAlerting: { type: 'boolean', default: false },
      consolidateAlerts: { type: 'boolean', default: true },
    })
    .strict()
    .parseSync() as ChainUptimeMonitorOptions
}

export const monitorChainUptime = async () => {
  const options = parseOptions()
  const config = getConfig({ configPath: options.configPath })

  const slackToken = process.env.CHAIN_UPTIME_MONITORING_SLACK_TOKEN
  const slackChannel = process.env.CHAIN_UPTIME_MONITORING_SLACK_CHANNEL

  console.log(
    '>>>>>> Processing chains: ',
    config.childChains.map((chain: ChildNetwork) => ({
      name: chain.name,
      chainID: chain.chainId,
      rpcUrl: chain.orbitRpcUrl,
    }))
  )

  const results: ChainUptimeResult[] = []
  const downChains: ChainUptimeResult[] = []
  const upChains: ChainUptimeResult[] = []

  // Process chains concurrently
  const promises = config.childChains.map(async (chain: ChildNetwork) => {
    try {
      const uptimeConfig: ChainUptimeConfig = {
        chain,
        timeout: 10000, // 10 second timeout
      }

      const result = await isChainRunning(
        uptimeConfig,
        // onSuccess callback
        async result => {
          console.log(
            `✅ ${result.chainName} (${result.chainId}): UP - Block ${result.blockNumber} (${result.responseTime}ms)`
          )
          upChains.push(result)
          // No alerts for up chains
        },
        // onError callback
        async result => {
          console.error(
            `❌ ${result.chainName} (${result.chainId}): DOWN - ${result.error} (${result.responseTime}ms)`
          )
          downChains.push(result)

          // Send individual alert if not consolidating
          if (options.enableAlerting && !options.consolidateAlerts) {
            await reportUptimeAlertToSlack({
              result,
              slackToken,
              slackChannel,
            })
          }
        }
      )

      results.push(result)
    } catch (error) {
      const errorResult: ChainUptimeResult = {
        chainId: chain.chainId,
        chainName: chain.name,
        rpcUrl: chain.orbitRpcUrl,
        isRunning: false,
        error: error instanceof Error ? error.message : String(error),
      }
      results.push(errorResult)
      downChains.push(errorResult)

      console.error(
        `Error checking uptime for ${chain.name} (${chain.chainId}): ${
          error instanceof Error ? error.message : String(error)
        }`
      )

      // Send individual alert if not consolidating
      if (options.enableAlerting && !options.consolidateAlerts) {
        await reportUptimeAlertToSlack({
          result: errorResult,
          slackToken,
          slackChannel,
        })
      }
    }
  })

  await Promise.allSettled(promises)

  // Summary
  const upCount = results.filter(r => r.isRunning).length
  const downCount = results.filter(r => !r.isRunning).length

  console.log('\n========== Chain Uptime Summary ==========')
  console.log(`Total Chains: ${results.length}`)
  console.log(`✅ Up: ${upCount}`)
  console.log(`❌ Down: ${downCount}`)

  if (downChains.length > 0) {
    console.log('\nDown Chains:')
    downChains.forEach(chain => {
      console.log(`  - ${chain.chainName} (${chain.chainId}): ${chain.error}`)
    })
  }

  // Send consolidated alert to Slack only if there are down chains
  if (
    options.enableAlerting &&
    options.consolidateAlerts &&
    downChains.length > 0 &&
    slackToken &&
    slackChannel
  ) {
    const summaryMessage =
      `❌ Chain Uptime Alert\n\n` +
      `Total Chains: ${results.length}\n` +
      `✅ Up: ${upCount}\n` +
      `❌ Down: ${downCount}\n\n` +
      `Down Chains:\n${downChains
        .map(c => `  - ${c.chainName} (${c.chainId}): ${c.error}`)
        .join('\n')}`

    await postSlackMessage({
      slackToken,
      slackChannel,
      message: summaryMessage,
    })
  }

  // Exit with error code if any chains are down
  if (downChains.length > 0) {
    process.exit(1)
  }
}

// Only run main if this is the entry point
if (require.main === module) {
  monitorChainUptime()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error)
      process.exit(1)
    })
}

// Export for SDK-like usage
export { isChainRunning } from './core/uptimeChecker'
export type {
  ChainUptimeConfig,
  ChainUptimeResult,
  OnChainUpCallback,
  OnChainDownCallback,
} from './core/types'
