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

// Configure Winston logger
const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logfile.log' }),
  ],
})

const logResult = (chainName: string, message: string) => {
  logger.info(`[${chainName}] ${message}`);
};

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
  console.log('----------------------------------------------------------');
  console.log(`Running for Orbit chain: ${childChain.name}`);
  console.log('----------------------------------------------------------');
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

  let retryablesFound: boolean = false;

  const getInboxMessageDeliveredEventData = async (
    parentInboxAddress: string,
    filter: {
      fromBlock: providers.BlockTag
      toBlock: providers.BlockTag
    },
    parentChainProvider: providers.Provider
  ) => {
    const eventFetcher = new EventFetcher(parentChainProvider);
    const logs = await eventFetcher.getEvents(
      Inbox__factory,
      (g: any) => g.filters.InboxMessageDelivered(),
      { ...filter, address: parentInboxAddress }
    );
    return logs;
  };

  const checkRetryablesOneOff = async (fromBlock: number, toBlock: number) => {
    if (toBlock === 0) {
      try {
        const currentBlock = await parentChainProvider.getBlockNumber()
        toBlock = currentBlock
      } catch (error) {
        console.error(
          `Error getting the latest block: ${(error as Error).message}`
        )
        toBlock = 0
      }
    }

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

    const uniqueTxHashes = new Set<string>()

    for (let inboxDeliveredLog of inboxDeliveredLogs) {
      if (inboxDeliveredLog.data.length === 706) continue // depositETH bypass
      const { transactionHash: parentTxHash } = inboxDeliveredLog
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
        );
        console.log("----------------------------------------------------------");
        for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
          const message = messages[msgIndex]
          const retryableTicketId = message.retryableCreationId
          let status = await message.status()

          // Format the result message
          const resultMessage = `${msgIndex + 1}. ${
            ParentToChildMessageStatus[status]
          }:\nOrbitTxHash: ${
            childChain.explorerUrl
          }tx/${retryableTicketId}`

          logResult(childChain.name, resultMessage)
          console.log("----------------------------------------------------------");
        }
        retryablesFound = true; // Set to true if retryables are found
      }
    }

    return retryablesFound;
  }

  const checkRetryablesContinuous = async () => {
    const processingDurationInSeconds = 30
    let isContinuous = options.continuous
    let fromBlock = options.fromBlock
    let toBlock = options.toBlock
    const startTime = Date.now()

    while (isContinuous) {

      const lastBlockChecked = await checkRetryablesOneOff(fromBlock, toBlock)
      fromBlock = lastBlockChecked + 1
      toBlock = lastBlockChecked // Set to the latest block checked

      const currentTime = Date.now()
      const elapsedTimeInSeconds = Math.floor((currentTime - startTime) / 1000)

      // Check if the processing duration has reached 3 minutes
      if (elapsedTimeInSeconds >= processingDurationInSeconds) {
        isContinuous = false
      }

      await new Promise(resolve => setTimeout(resolve, 1000)) // 1-second delay between iterations
    }
  }

  if (options.continuous) {
    await checkRetryablesContinuous()
  } else {
    await checkRetryablesOneOff(options.fromBlock, options.toBlock);

    // Log a message if no retryables were found for the child chain
    if (!retryablesFound) {
      console.log(`No retryables found for ${childChain.name}`);
      console.log("----------------------------------------------------------");
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
