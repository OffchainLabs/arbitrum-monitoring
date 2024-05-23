import { providers } from 'ethers'
import {
  EventFetcher,
  addCustomNetwork,
  L1TransactionReceipt as ParentChainTxReceipt,
  L1ToL2MessageStatus as ParentToChildMessageStatus,
  L2Network as ParentNetwork,
} from '@arbitrum/sdk'
import { Bridge__factory } from '@arbitrum/sdk/dist/lib/abi/factories/Bridge__factory'
import * as fs from 'fs'
import * as path from 'path'
import yargs from 'yargs'
import winston from 'winston'

// Interface defining additional properties for ChildNetwork
export interface ChildNetwork extends ParentNetwork {
  parentRpcUrl: string
  orbitRpcUrl: string
  parentExplorerUrl: string
}

// Type for options passed to findRetryables function
type findRetryablesOptions = {
  fromBlock: number
  toBlock: number
  continuous: boolean
  configPath: string
}

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

// Function to log results with chainName
const logResult = (chainName: string, message: string) => {
  logger.info(`[${chainName}] ${message}`)
}

// Parsing command line arguments using yargs
const options: findRetryablesOptions = yargs(process.argv.slice(2))
  .options({
    fromBlock: { type: 'number', default: 0 },
    toBlock: { type: 'number', default: 0 },
    continuous: { type: 'boolean', default: false },
    configPath: { type: 'string', default: 'config.json' },
  })
  .strict()
  .parseSync() as findRetryablesOptions

// Function to process a child chain and check for retryable transactions
const processChildChain = async (
  childChain: ChildNetwork,
  options: findRetryablesOptions
) => {
  console.log('----------------------------------------------------------')
  console.log(`Running for Orbit chain: ${childChain.name}`)
  console.log('----------------------------------------------------------')
  try {
    addCustomNetwork({ customL2Network: childChain })
  } catch (error: any) {
    console.error(`Failed to register the child network: ${error.message}`)
    return
  }

  const parentChainProvider = new providers.JsonRpcProvider(
    String(childChain.parentRpcUrl)
  )

  const childChainProvider = new providers.JsonRpcProvider(
    String(childChain.orbitRpcUrl)
  )

  let retryablesFound: boolean = false

  // Function to get MessageDelivered events from the parent chain
  const getMessageDeliveredEventData = async (
    parentBridgeAddress: string,
    filter: {
      fromBlock: providers.BlockTag
      toBlock: providers.BlockTag
    },
    parentChainProvider: providers.Provider
  ) => {
    const eventFetcher = new EventFetcher(parentChainProvider)
    const logs = await eventFetcher.getEvents(
      Bridge__factory,
      (g: any) => g.filters.MessageDelivered(),
      { ...filter, address: parentBridgeAddress }
    )

    // Filter logs where event.kind is equal to 9
    // https://github.com/OffchainLabs/nitro-contracts/blob/38a70a5e14f8b52478eb5db08e7551a82ced14fe/src/libraries/MessageTypes.sol#L9
    const filteredLogs = logs.filter(log => log.event.kind === 9)

    return filteredLogs
  }

  // Function to check retryable transactions in a specific block range
  const checkRetryablesOneOff = async (
    fromBlock: number,
    toBlock: number
  ): Promise<number> => {
    if (toBlock === 0) {
      try {
        const currentBlock = await parentChainProvider.getBlockNumber()
        if (!currentBlock) {
          throw new Error('Failed to retrieve the latest block.')
        }
        toBlock = currentBlock
      } catch (error) {
        console.error(
          `Error getting the latest block: ${(error as Error).message}`
        )
        throw error
      }
    }

    retryablesFound = await checkRetryables(
      parentChainProvider,
      childChainProvider,
      childChain.ethBridge.bridge,
      fromBlock,
      toBlock
    )

    return toBlock
  }

  const checkRetryables = async (
    parentChainProvider: providers.Provider,
    childChainProvider: providers.Provider,
    bridgeAddress: string,
    fromBlock: number,
    toBlock: number
  ): Promise<boolean> => {
    const messageDeliveredLogs = await getMessageDeliveredEventData(
      bridgeAddress,
      { fromBlock, toBlock },
      parentChainProvider
    )

    const uniqueTxHashes = new Set<string>()

    for (let messageDeliveredLog of messageDeliveredLogs) {
      const { transactionHash: parentTxHash } = messageDeliveredLog
      uniqueTxHashes.add(parentTxHash)
    }

    for (const parentTxHash of uniqueTxHashes) {
      const parentTxReceipt = await parentChainProvider.getTransactionReceipt(
        parentTxHash
      )
      const arbParentTxReceipt = new ParentChainTxReceipt(parentTxReceipt)
      const messages = await arbParentTxReceipt.getL1ToL2Messages(
        childChainProvider
      )

      if (messages.length > 0) {
        logResult(
          childChain.name,
          `${messages.length} retryable${
            messages.length === 1 ? '' : 's'
          } found for ${
            childChain.name
          } chain. Checking their status:\n\nArbtxhash: ${
            childChain.parentExplorerUrl
          }tx/${parentTxHash}`
        )
        console.log(
          '----------------------------------------------------------'
        )
        for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
          const message = messages[msgIndex]
          const retryableTicketId = message.retryableCreationId
          let status = await message.status()

          // Format the result message
          const resultMessage = `${msgIndex + 1}. ${
            ParentToChildMessageStatus[status]
          }:\nOrbitTxHash: ${childChain.explorerUrl}tx/${retryableTicketId}`

          logResult(childChain.name, resultMessage)
          console.log(
            '----------------------------------------------------------'
          )
        }
        retryablesFound = true // Set to true if retryables are found
      }
    }

    return retryablesFound
  }

  // Function to continuously check retryable transactions
  const checkRetryablesContinuous = async (
    fromBlock: number,
    toBlock: number
  ) => {
    const processingDurationInSeconds = 180
    let isContinuous = options.continuous
    const startTime = Date.now()

    // Function to process blocks and check for retryables
    const processBlocks = async () => {
      const lastBlockChecked = await checkRetryablesOneOff(fromBlock, toBlock)
      console.log('Check completed for block:', lastBlockChecked)
      fromBlock = lastBlockChecked + 1
      console.log('Continuing from block:', fromBlock)

      toBlock = await parentChainProvider.getBlockNumber()
      console.log(`Processed blocks up to ${lastBlockChecked}`)

      return lastBlockChecked
    }

    // Continuous loop for checking retryables
    while (isContinuous) {
      const lastBlockChecked = await processBlocks()

      if (lastBlockChecked >= toBlock) {
        // Wait for a short interval before checking again
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      const currentTime = Date.now()
      const elapsedTimeInSeconds = Math.floor((currentTime - startTime) / 1000)

      if (elapsedTimeInSeconds >= processingDurationInSeconds) {
        isContinuous = false
      }
    }
  }

  if (options.continuous) {
    console.log('Continuous mode activated.')
    await checkRetryablesContinuous(options.fromBlock, options.toBlock)
  } else {
    console.log('One-off mode activated.')
    await checkRetryablesOneOff(options.fromBlock, options.toBlock)
    // Log a message if no retryables were found for the child chain
    if (!retryablesFound) {
      console.log(`No retryables found for ${childChain.name}`)
      console.log('----------------------------------------------------------')
    }
  }
}

// Read the content of the config file
const configFileContent = fs.readFileSync(
  path.join(process.cwd(), 'lib', options.configPath),
  'utf-8'
)

// Parse the config file content as JSON
const config = JSON.parse(configFileContent)

// Check if childChains array is present in the config file
if (!Array.isArray(config.childChains)) {
  console.error('Error: Child chains not found in the config file.')
  process.exit(1)
}

// Function to process multiple child chains concurrently
const processOrbitChainsConcurrently = async () => {
  const promises = config.childChains.map((childChain: ChildNetwork) =>
    processChildChain(childChain, options)
  )

  // keep running the script until we get resolution (success or error) for all the chains
  await Promise.allSettled(promises)
}

// Start processing child chains concurrently
processOrbitChainsConcurrently()
