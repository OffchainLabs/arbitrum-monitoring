import { PublicClient, createPublicClient, http } from 'viem'
import yargs from 'yargs'
import {
  ChildNetwork as ChainInfo,
  DEFAULT_CONFIG_PATH,
  getConfig,
  resolveRollupAddress,
} from 'utils'
import { arbSysAbi, rollupAbi } from './abi'
import {
  ARBOS_VERSION_OFFSET,
  ARBSYS_ADDRESS,
  DEFAULT_MINIMUM_ARBOS_VERSION,
} from './constants'
import { evaluateArbosVersion } from './monitoring'
import { reportArbosVersionAlertToSlack } from './reportArbosVersionAlertToSlack'

/**  Retrieves and validates the monitor configuration from the config file. */
export const getMonitorConfig = (configPath: string = DEFAULT_CONFIG_PATH) => {
  const options = yargs(process.argv.slice(2))
    .options({
      configPath: { type: 'string', default: configPath },
      enableAlerting: { type: 'boolean', default: false },
      writeToNotion: { type: 'boolean', default: false },
      minimumArbosVersion: {
        type: 'number',
        default: DEFAULT_MINIMUM_ARBOS_VERSION,
      },
    })
    .strict()
    .parseSync()

  const config = getConfig(options)

  if (!Array.isArray(config.childChains) || config.childChains.length === 0) {
    throw new Error('Error: Chains not found in the config file.')
  }

  return { config, options }
}

/**
 * Reads ArbSys.arbOSVersion() from the child chain RPC.
 * Returns null if the RPC is unavailable or returns an invalid value.
 */
export const fetchArbosVersionFromChildChain = async (
  childChainInfo: ChainInfo
): Promise<number | null> => {
  try {
    const childClient = createPublicClient({
      transport: http(childChainInfo.orbitRpcUrl),
    })
    const rawVersion = await childClient.readContract({
      address: ARBSYS_ADDRESS,
      abi: arbSysAbi,
      functionName: 'arbOSVersion',
    })

    if (
      rawVersion === undefined ||
      rawVersion === null ||
      rawVersion <= ARBOS_VERSION_OFFSET
    ) {
      console.warn(
        `[${childChainInfo.name}] ArbSys.arbOSVersion() returned an invalid value: ${rawVersion}`
      )
      return null
    }

    return Number(rawVersion - ARBOS_VERSION_OFFSET)
  } catch (error) {
    console.warn(
      `[${
        childChainInfo.name
      }] Failed to read ArbSys.arbOSVersion() from child chain RPC: ${
        error instanceof Error ? error.message : error
      }`
    )
    return null
  }
}

/**
 * Reads wasmModuleRoot() from the rollup contract on the parent chain.
 * Returns null if it could not be read.
 */
export const fetchWasmModuleRootFromParentChain = async (
  parentClient: PublicClient,
  childChainInfo: ChainInfo
): Promise<string | null> => {
  try {
    const rollupAddress = await resolveRollupAddress(
      parentClient,
      childChainInfo.ethBridge,
      childChainInfo.name
    )
    return await parentClient.readContract({
      address: rollupAddress as `0x${string}`,
      abi: rollupAbi,
      functionName: 'wasmModuleRoot',
    })
  } catch (error) {
    console.warn(
      `[${
        childChainInfo.name
      }] Failed to read wasmModuleRoot from rollup contract: ${
        error instanceof Error ? error.message : error
      }`
    )
    return null
  }
}

/**
 * Checks a single chain's ArbOS version. Returns an alert string when the
 * chain is outdated (or undeterminable), undefined otherwise.
 */
export const checkChainArbosVersion = async (
  childChainInfo: ChainInfo,
  minimumArbosVersion: number
): Promise<string | undefined> => {
  console.log(`\nMonitoring ${childChainInfo.name}...`)

  const parentClient = createPublicClient({
    transport: http(childChainInfo.parentRpcUrl),
  })

  const [arbosVersion, wasmModuleRoot] = await Promise.all([
    fetchArbosVersionFromChildChain(childChainInfo),
    fetchWasmModuleRootFromParentChain(parentClient, childChainInfo),
  ])

  const result = evaluateArbosVersion({
    chainName: childChainInfo.name,
    arbosVersion,
    wasmModuleRoot,
    minimumArbosVersion,
  })

  if (result.kind === 'skip') {
    console.log(result.reason)
    return
  }

  if (result.kind === 'alert') {
    console.log(`[${childChainInfo.name}] ${result.message}`)
    return `${childChainInfo.name}:\n- ${result.message}`
  }

  console.log(
    `[${childChainInfo.name}] ArbOS ${result.version} (source: ${
      result.source === 'arbsys'
        ? 'ArbSys.arbOSVersion()'
        : 'wasmModuleRoot fallback'
    }) — OK`
  )
  return
}

/**
 * Entry point for the ArbOS version monitoring system.
 * Reports issues to Slack when alerting is enabled.
 */
export const main = async () => {
  try {
    const { config, options } = getMonitorConfig()
    const alerts: string[] = []
    console.log(
      `Starting ArbOS version monitoring (minimum version: ${options.minimumArbosVersion})...`
    )

    for (const chainInfo of config.childChains) {
      try {
        const result = await checkChainArbosVersion(
          chainInfo,
          options.minimumArbosVersion
        )
        if (result) {
          alerts.push(result)
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        const errorStr = `Error processing chain ${chainInfo.name} for ArbOS version monitoring: ${errorMessage}`
        if (options.enableAlerting) {
          await reportArbosVersionAlertToSlack({ message: errorStr })
        }
        console.error(errorStr)
      }
    }

    if (alerts.length > 0) {
      const alertMessage = `ArbOS Version Monitor Alert Summary:\n\n${alerts.join(
        '\n\n'
      )}`
      console.log(alertMessage)

      if (options.enableAlerting) {
        console.log('Sending alerts to Slack...')
        await reportArbosVersionAlertToSlack({ message: alertMessage })
      }
    } else {
      console.log('\nMonitoring complete - all chains healthy')
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStr = `Error processing chain data for ArbOS version monitoring: ${errorMessage}`
    const { options } = getMonitorConfig()
    if (options.enableAlerting) {
      await reportArbosVersionAlertToSlack({ message: errorStr })
    }
    console.error(errorStr)
  }
}
