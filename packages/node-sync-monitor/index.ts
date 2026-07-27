import { PublicClient, createPublicClient, http } from 'viem'
import yargs from 'yargs'
import {
  ChildNetwork as ChainInfo,
  DEFAULT_CONFIG_PATH,
  getConfig,
} from 'utils'
import { evaluateNodeSync } from './monitoring'
import { reportNodeSyncAlertToSlack } from './reportNodeSyncAlertToSlack'

const DEFAULT_BLOCK_LAG_THRESHOLD = 100

/**
 * Parses CLI options. Kept separate from config loading so it can be called
 * outside the config try/catch — option parsing can't fail the way reading the
 * config file can, so the error handler can rely on the parsed options.
 */
export const getOptions = (configPath: string = DEFAULT_CONFIG_PATH) =>
  yargs(process.argv.slice(2))
    .options({
      configPath: { type: 'string', default: configPath },
      enableAlerting: { type: 'boolean', default: false },
      blockLagThreshold: {
        type: 'number',
        default: DEFAULT_BLOCK_LAG_THRESHOLD,
      },
    })
    .strict()
    .parseSync()

/**  Retrieves and validates the monitor configuration from the config file. */
export const getMonitorConfig = (configPath: string = DEFAULT_CONFIG_PATH) => {
  const options = getOptions(configPath)

  // yargs coerces non-numeric values to NaN without erroring, and every
  // `lag > NaN` comparison is false — lag alerting would silently disable.
  if (
    !Number.isFinite(options.blockLagThreshold) ||
    options.blockLagThreshold < 0
  ) {
    throw new Error(`Invalid --blockLagThreshold: ${options.blockLagThreshold}`)
  }

  const config = getConfig(options)

  if (!Array.isArray(config.childChains) || config.childChains.length === 0) {
    throw new Error('Error: Chains not found in the config file.')
  }

  return { config, options }
}

/** Calls eth_syncing. Returns null if the call failed. */
const fetchSyncStatus = async (
  client: PublicClient,
  chainName: string,
  nodeUrl: string
): Promise<false | Record<string, unknown> | null> => {
  try {
    // eth_syncing is not part of viem's public-client schema; use a schema override.
    return await client.request<{
      Parameters?: undefined
      ReturnType: false | Record<string, unknown>
    }>({ method: 'eth_syncing' })
  } catch (error) {
    console.warn(
      `[${chainName}] Failed to read eth_syncing from node RPC ${nodeUrl}: ${
        error instanceof Error ? error.message : error
      }`
    )
    return null
  }
}

/** Calls eth_blockNumber. Returns null if the call failed. */
const fetchBlockNumber = async (
  client: PublicClient,
  chainName: string,
  source: string
): Promise<bigint | null> => {
  try {
    return await client.getBlockNumber()
  } catch (error) {
    console.warn(
      `[${chainName}] Failed to read eth_blockNumber from ${source} RPC: ${
        error instanceof Error ? error.message : error
      }`
    )
    return null
  }
}

/**
 * Checks one chain's nodes against the chain's trusted reference RPC.
 * All nodes are compared against a single reference reading so they share
 * the same baseline. Returns an alert string listing every unhealthy node,
 * or undefined when all nodes are healthy.
 */
export const checkChainNodeSync = async (
  chainInfo: ChainInfo,
  blockLagThreshold: number
): Promise<string | undefined> => {
  const nodeUrls = chainInfo.monitoredNodeRpcUrls
  if (!nodeUrls || nodeUrls.length === 0) {
    console.log(
      `[${chainInfo.name}] No monitoredNodeRpcUrls configured, skipping.`
    )
    return
  }

  if (!chainInfo.referenceRpcUrl) {
    const message =
      'monitoredNodeRpcUrls is set but referenceRpcUrl is missing; both are required for node sync monitoring.'
    console.log(`[${chainInfo.name}] ${message}`)
    return `${chainInfo.name}:\n- ${message}`
  }

  console.log(`\nMonitoring ${chainInfo.name} (${nodeUrls.length} node(s))...`)

  const referenceClient = createPublicClient({
    transport: http(chainInfo.referenceRpcUrl),
  })
  // fetchBlockNumber never rejects (it returns null on failure), so this
  // shared promise can be awaited concurrently by every node check below.
  const referenceBlockPromise = fetchBlockNumber(
    referenceClient,
    chainInfo.name,
    'reference'
  )

  const nodeAlerts = (
    await Promise.all(
      nodeUrls.map(async nodeUrl => {
        const nodeClient = createPublicClient({
          transport: http(nodeUrl),
        })

        const [syncStatus, nodeBlock, referenceBlock] = await Promise.all([
          fetchSyncStatus(nodeClient, chainInfo.name, nodeUrl),
          fetchBlockNumber(nodeClient, chainInfo.name, `node ${nodeUrl}`),
          referenceBlockPromise,
        ])

        const result = evaluateNodeSync({
          syncStatus,
          nodeBlock,
          referenceBlock,
          blockLagThreshold,
        })

        if (result.kind === 'alert') {
          console.log(`[${chainInfo.name}] [${nodeUrl}] ${result.message}`)
          return `- [${nodeUrl}] ${result.message}`
        }

        console.log(
          `[${chainInfo.name}] [${nodeUrl}] Node synced at block ${nodeBlock} (${result.lag} blocks behind reference) — OK`
        )
        return undefined
      })
    )
  ).filter((alert): alert is string => alert !== undefined)

  if (nodeAlerts.length === 0) {
    return
  }

  return `${chainInfo.name} (${nodeAlerts.length}/${
    nodeUrls.length
  } nodes unhealthy):\n${nodeAlerts.join('\n')}`
}

/**
 * Entry point for the node sync monitoring system.
 * Reports issues to Slack when alerting is enabled.
 */
export const main = async () => {
  // Parse options up front so the outer catch can report config-load failures
  // to Slack without re-invoking getMonitorConfig() (which would just re-throw).
  const options = getOptions()
  try {
    const { config } = getMonitorConfig()
    const alerts: string[] = []
    console.log(
      `Starting node sync monitoring (block lag threshold: ${options.blockLagThreshold})...`
    )

    for (const chainInfo of config.childChains) {
      try {
        const result = await checkChainNodeSync(
          chainInfo,
          options.blockLagThreshold
        )
        if (result) {
          alerts.push(result)
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        const errorStr = `Error processing chain ${chainInfo.name} for node sync monitoring: ${errorMessage}`
        if (options.enableAlerting) {
          await reportNodeSyncAlertToSlack({ message: errorStr })
        }
        console.error(errorStr)
      }
    }

    if (alerts.length > 0) {
      const alertMessage = `Node Sync Monitor Alert Summary:\n\n${alerts.join(
        '\n\n'
      )}`
      console.log(alertMessage)

      if (options.enableAlerting) {
        console.log('Sending alerts to Slack...')
        await reportNodeSyncAlertToSlack({ message: alertMessage })
      }
    } else {
      console.log('\nMonitoring complete - all nodes healthy')
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStr = `Error processing chain data for node sync monitoring: ${errorMessage}`
    if (options.enableAlerting) {
      await reportNodeSyncAlertToSlack({ message: errorStr })
    }
    console.error(errorStr)
  }
}
