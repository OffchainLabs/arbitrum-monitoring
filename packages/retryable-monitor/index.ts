import * as fs from 'fs'
import yargs from 'yargs'
import winston from 'winston'
import { providers } from 'ethers'
import {
  getArbitrumNetwork,
  registerCustomArbitrumNetwork,
} from '@arbitrum/sdk'
import { FindRetryablesOptions } from './core/types'
import { ChildNetwork, DEFAULT_CONFIG_PATH, getConfig } from '../utils'
import {
  checkRetryablesOneOff,
  checkRetryablesContinuous,
} from './core/retryableCheckerMode'
import { reportFailedRetryables } from './handlers/failedRetryableHandler'
import { postSlackMessage } from './handlers/postSlackMessage'

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
  })
  .strict()
  .parseSync() as FindRetryablesOptions

const config = getConfig({ configPath: options.configPath })

// Function to process a child chain and check for retryable transactions
const processChildChain = async (
  childChain: ChildNetwork,
  options: FindRetryablesOptions
) => {
  console.log('----------------------------------------------------------')
  console.log(`Running for Chain: ${childChain.name}`)
  console.log('----------------------------------------------------------')
  if (!networkIsRegistered(childChain.chainId)) {
    registerCustomArbitrumNetwork(childChain)
  }

  const parentChainProvider = new providers.JsonRpcProvider(
    String(childChain.parentRpcUrl)
  )

  const childChainProvider = new providers.JsonRpcProvider(
    String(childChain.orbitRpcUrl)
  )

  if (options.continuous) {
    console.log('Continuous mode activated.')
    await checkRetryablesContinuous(
      parentChainProvider,
      childChainProvider,
      childChain,
      options.fromBlock,
      options.toBlock,
      options.enableAlerting,
      options.continuous,
      reportFailedRetryables
    )
  } else {
    console.log('One-off mode activated.')
    const retryablesFound = await checkRetryablesOneOff(
      parentChainProvider,
      childChainProvider,
      childChain,
      options.fromBlock,
      options.toBlock,
      options.enableAlerting,
      reportFailedRetryables
    )
    // Log a message if no retryables were found for the child chain
    if (!retryablesFound) {
      console.log(`No retryables found for ${childChain.name}`)
      console.log('----------------------------------------------------------')
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

  const promises = config.childChains.map(async (childChain: ChildNetwork) => {
    try {
      return await processChildChain(childChain, options)
    } catch (e) {
      const errorStr = `Retryable monitor - Error processing chain [${childChain.name}]: ${e.message}`
      if (options.enableAlerting) {
        postSlackMessage({
          message: errorStr,
        })
      }
      console.error(errorStr)
    }
  })

  // keep running the script until we get resolution (success or error) for all the chains
  await Promise.allSettled(promises)
}

// Start processing child chains concurrently
processOrbitChainsConcurrently()
