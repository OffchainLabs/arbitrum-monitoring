import { providers } from 'ethers'
import {
  EventFetcher,
  addCustomNetwork,
  L1TransactionReceipt as ParentChainTxReceipt,
  L1ToL2MessageStatus as ParentToChildMessageStatus,
  L2Network as ParentNetwork,
} from '@arbitrum/sdk'
import { Inbox__factory } from '@arbitrum/sdk/dist/lib/abi/factories/Inbox__factory'
import * as fs from 'fs'
import * as path from 'path'
import yargs from 'yargs'
import winston from 'winston'
import { promises as fsPromises } from 'fs';

export interface ChildNetwork extends ParentNetwork {
  parentRpcUrl: string
  orbitRpcUrl: string
  parentExplorerUrl: string
}

type findRetryablesOptions = {
  fromBlock: number
  toBlock: number
  continuous: boolean
  configPath: string
}

const logFilePath = 'logfile.log';
// Truncate the log file to clear its contents
try {
  fsPromises.truncate(logFilePath, 0);
} catch (error) {
  console.error(`Error truncating log file: ${(error as Error).message}`);
}

// Configure Winston logger
const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: logFilePath }),
  ],
});

const logResult = (chainName: string, message: string) => {
  logger.info(`[${chainName}] ${message}`)
}

const options: findRetryablesOptions = yargs(process.argv.slice(2))
  .options({
    fromBlock: { type: 'number', default: 0 },
    toBlock: { type: 'number', default: 0 },
    continuous: { type: 'boolean', default: false },
    configPath: { type: 'string', default: 'config.json' },
  })
  .strict()
  .parseSync() as findRetryablesOptions

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

  const getInboxMessageDeliveredEventData = async (
    parentInboxAddress: string,
    filter: {
      fromBlock: providers.BlockTag
      toBlock: providers.BlockTag
    },
    parentChainProvider: providers.Provider
  ) => {
    const eventFetcher = new EventFetcher(parentChainProvider)
    const logs = await eventFetcher.getEvents(
      Inbox__factory,
      (g: any) => g.filters.InboxMessageDelivered(),
      { ...filter, address: parentInboxAddress }
    )
    return logs
  }

  const checkRetryablesOneOff = async (
    fromBlock: number,
    toBlock: number
  ): Promise<number> => {
    if (toBlock === 0) {
      try {
        const currentBlock = await parentChainProvider.getBlockNumber();
        if (!currentBlock) {
          throw new Error('Failed to retrieve the latest block.');
        }
        toBlock = currentBlock;
      } catch (error) {
        console.error(`Error getting the latest block: ${(error as Error).message}`);
        throw error;
      }
    }
  
    //console.log(`processing from ${fromBlock} to ${toBlock}` );

    retryablesFound = await checkRetryables(
      parentChainProvider,
      childChainProvider,
      childChain.ethBridge.inbox,
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
    const inboxDeliveredLogs = await getInboxMessageDeliveredEventData(
      bridgeAddress,
      { fromBlock, toBlock },
      parentChainProvider
    )

    //console.log(`Found ${inboxDeliveredLogs.length} inboxDeliveredLogs from block ${fromBlock} to ${toBlock}`);

    const thresholdWarning = 100 // the threshhold at which it will give the warning that processing may take a while

    if (inboxDeliveredLogs.length > thresholdWarning) {
      console.log('----------------------------------------------------------')
      console.warn(
        `Warning: High number of inboxDeliveredLogs detected (${inboxDeliveredLogs.length}). Processing may take some time.`
      )
      console.log('----------------------------------------------------------')
    }

    const uniqueTxHashes = new Set<string>()

    for (let inboxDeliveredLog of inboxDeliveredLogs) {
      if (inboxDeliveredLog.data.length === 706) continue // depositETH bypass
      const { transactionHash: parentTxHash } = inboxDeliveredLog
      uniqueTxHashes.add(parentTxHash)
    }
    //console.log(`Found ${uniqueTxHashes.size} unique transactions from inboxDeliveredLogs`);

    for (const parentTxHash of uniqueTxHashes) {
      //console.log(`Checking transaction ${parentTxHash}`);
      const parentTxReceipt = await parentChainProvider.getTransactionReceipt(
        parentTxHash
      )
      const arbParentTxReceipt = new ParentChainTxReceipt(parentTxReceipt)
      const messages = await arbParentTxReceipt.getL1ToL2Messages(
        childChainProvider
      )
      //console.log(`Found ${messages.length} L1ToL2Messages for transaction ${parentTxHash}`);

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

  const checkRetryablesContinuous = async (
    fromBlock: number,
    toBlock: number
  ) => {
    const processingDurationInSeconds = 180
    let isContinuous = options.continuous
    const startTime = Date.now()

    const processBlocks = async () => {
      const lastBlockChecked = await checkRetryablesOneOff(fromBlock, toBlock)
      console.log('Check completed for block:', lastBlockChecked)
      fromBlock = lastBlockChecked + 1
      console.log('Continuing from block:', fromBlock)

      toBlock = await parentChainProvider.getBlockNumber()
      console.log(`Processed blocks up to ${lastBlockChecked}`)

      const currentTime = Date.now()
      const elapsedTimeInSeconds = Math.floor((currentTime - startTime) / 1000)

      // Log time-related information at regular intervals
      if (elapsedTimeInSeconds % 60 === 0) {
        console.log(
          `[${childChain.name}] Current Time: ${new Date(
            currentTime
          ).toISOString()}`
        )
        console.log(
          `[${childChain.name}] Elapsed Time: ${elapsedTimeInSeconds} seconds`
        )
      }

      return lastBlockChecked
    }

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

    // Log final time-related information
    const currentTime = Date.now()
    const elapsedTimeInSeconds = Math.floor((currentTime - startTime) / 1000)

    console.log(
      `[${childChain.name}] Current Time: ${new Date(
        currentTime
      ).toISOString()}`
    )
    console.log(
      `[${childChain.name}] Elapsed Time: ${elapsedTimeInSeconds} seconds`
    )
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

const configFileContent = fs.readFileSync(
  path.join(process.cwd(), 'lib', options.configPath),
  'utf-8'
)

const config = JSON.parse(configFileContent)

if (!Array.isArray(config.childChains)) {
  console.error('Error: Child chains not found in the config file.')
  process.exit(1)
}

const processOrbitChainsConcurrently = async () => {
  for (const childChain of config.childChains) {
    await processChildChain(childChain, options)
  }
}

processOrbitChainsConcurrently()
