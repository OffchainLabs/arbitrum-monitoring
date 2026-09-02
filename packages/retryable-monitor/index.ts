import * as fs from 'fs'
import yargs from 'yargs'
import winston from 'winston'
import { providers } from 'ethers'
import {
  getArbitrumNetwork,
  registerCustomArbitrumNetwork,
} from '@arbitrum/sdk'
import { FindRetryablesOptions } from './core/types'
import { ChildNetwork, DEFAULT_CONFIG_PATH, getConfig } from 'utils'
import {
  checkRetryablesOneOff,
  checkRetryablesContinuous,
} from './core/retryableCheckerMode'
import { postSlackMessage } from './handlers/slack/postSlackMessage'
import { alertUntriagedNotionRetryables } from './handlers/notion/alertUntriagedRetraybles'
import { fetchNotionRetryables } from './handlers/notion/fetchedNotionRetryablesUtils'
import { handleFailedRetryablesFound } from './handlers/handleFailedRetryablesFound'
import { handleRedeemedRetryablesFound } from './handlers/handleRedeemedRetryablesFound'
import { postZeroValueDigest } from './handlers/zeroValueTicketDigest'
import { postFundedTicketAlerts } from './handlers/fundedTicketDigest'
import { writeRunReport } from './handlers/runReport'

// Path for the log file
const logFilePath = 'logfile.log'

// Check if the log file exists, if not, create it
try {
  fs.accessSync(logFilePath)
} catch (error) {
  try {
    fs.writeFileSync(logFilePath, '')
    console.log(`Log file created: ${logFilePath}`)
  } catch (createError) {
    console.error(`Error creating log file: ${(createError as Error).message}`)
    process.exit(1)
  }
}

// Configure Winston logger
const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: logFilePath }),
  ],
})

const networkIsRegistered = (networkId: number) => {
  try {
    getArbitrumNetwork(networkId)
    return true
  } catch (_) {
    return false
  }
}

// Parsing command line arguments using yargs
const options: FindRetryablesOptions = yargs(process.argv.slice(2))
  .options({
    fromBlock: { type: 'number', default: 0 },
    toBlock: { type: 'number', default: 0 },
    continuous: { type: 'boolean', default: false },
    configPath: { type: 'string', default: DEFAULT_CONFIG_PATH },
    enableAlerting: { type: 'boolean', default: false },
    writeToNotion: { type: 'boolean', default: false },
    autoRedeem: { type: 'boolean', default: false },
  })
  .strict()
  .parseSync() as FindRetryablesOptions

if (options.autoRedeem && !options.writeToNotion) {
  console.warn(
    '[retryable-monitor] --autoRedeem has no effect unless the Notion sweep runs. ' +
      'You can enable it with --writeToNotion.'
  )
}

const config = getConfig({ configPath: options.configPath })

// Function to process a child chain and check for retryable transactions
const processChildChain = async (
  parentChainProvider: providers.Provider,
  childChainProvider: providers.Provider,
  childChain: ChildNetwork,
  fromBlock: number,
  toBlock: number,
  enableAlerting: boolean,
  continuous: boolean,
  writeToNotion: boolean
) => {
  if (continuous) {
    console.log('Activating continuous check for retryables...')
    await checkRetryablesContinuous({
      parentChainProvider,
      childChainProvider,
      childChain,
      fromBlock,
      toBlock,
      enableAlerting,
      continuous,
      onFailedRetryableFound: async ticket => {
        await handleFailedRetryablesFound(ticket, writeToNotion)
      },
      onRedeemedRetryableFound: async ticket => {
        await handleRedeemedRetryablesFound(ticket, writeToNotion)
      },
    })
  } else {
    console.log('Activating one-off check for retryables...')
    const retryablesFound = await checkRetryablesOneOff({
      parentChainProvider,
      childChainProvider,
      childChain,
      fromBlock,
      toBlock,
      enableAlerting,
      onFailedRetryableFound: async ticket => {
        await handleFailedRetryablesFound(ticket, writeToNotion)
      },
      onRedeemedRetryableFound: async ticket => {
        await handleRedeemedRetryablesFound(ticket, writeToNotion)
      },
    })

    if (retryablesFound === 0) {
      console.log('No retryables found in the specified block range.')
    }
  }
}

// Function to process multiple child chains concurrently
const processOrbitChainsConcurrently = async () => {
  // log the chains being processed for better debugging in github actions
  console.log(
    '>>>>>> Processing child chains: ',
    config.childChains.map((childChain: ChildNetwork) => ({
      name: childChain.name,
      chainID: childChain.chainId,
      orbitRpcUrl: childChain.orbitRpcUrl,
      parentRpcUrl: childChain.parentRpcUrl,
    }))
  )

  // Fetch the list of existing Notion retryables once before any chain
  // processing so the redeemed-retryable handler can short-circuit the common
  // case (redeemed tickets that were never logged to Notion).
  if (options.writeToNotion) {
    await fetchNotionRetryables()
  }

  const promises = config.childChains.map(async (childChain: ChildNetwork) => {
    try {
      if (!networkIsRegistered(childChain.chainId)) {
        registerCustomArbitrumNetwork(childChain)
      }

      const parentChainProvider = new providers.JsonRpcProvider(
        String(childChain.parentRpcUrl)
      )
      const childChainProvider = new providers.JsonRpcProvider(
        String(childChain.orbitRpcUrl)
      )

      return await processChildChain(
        parentChainProvider,
        childChainProvider,
        childChain,
        options.fromBlock,
        options.toBlock,
        options.enableAlerting,
        options.continuous,
        options.writeToNotion
      )
    } catch (e) {
      const errorStr = `Retryable monitor - Error processing chain [${childChain.name}]: ${e.message}`
      if (options.enableAlerting) {
        postSlackMessage({
          message: errorStr,
        })
      }
      console.error(errorStr)
    } finally {
      // zero-value and funded tickets accumulate while the chain is checked;
      // flush both per-chain buffers even when processing errored mid-run so
      // partial results are posted instead of silently dropped (no-ops when
      // nothing was accumulated)
      await postZeroValueDigest(childChain)
      await postFundedTicketAlerts(childChain)
    }
  })

  // keep running the script until we get resolution (success or error) for all the chains
  await Promise.allSettled(promises)

  // once we process all the chains go through the Notion database once to alert on any `Unresolved` tickets found
  if (options.writeToNotion) {
    await alertUntriagedNotionRetryables(
      config.childChains,
      options.autoRedeem,
      options.configPath
    )

    // one sweep covering every chain, never one sweep per chain: concurrent
    // sweeps read the same rows and would each submit a redemption for them
    if (options.continuous) {
      console.log('Activating continuous sweep of Notion database...')
      setInterval(async () => {
        await alertUntriagedNotionRetryables(
          config.childChains,
          options.autoRedeem,
          options.configPath
        )
      }, 1000 * 60 * 60) // Run every hour
    }
  }

  // dump every failed retryable found in this run to a JSON file which CI
  // uploads as a run artifact, so tickets can be referenced/redeemed later
  writeRunReport()
}

// Start processing child chains concurrently
processOrbitChainsConcurrently()
