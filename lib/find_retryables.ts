import { BigNumber, providers } from 'ethers'
import {
  EventFetcher,
  addCustomNetwork,
  L1TransactionReceipt as ParentChainTxReceipt,
  L1ToL2MessageStatus as ParentToChildMessageStatus,
  L2Network as ParentNetwork,
  getL2Network,
  L1ToL2MessageStatus,
} from '@arbitrum/sdk'
import { Bridge__factory } from '@arbitrum/sdk/dist/lib/abi/factories/Bridge__factory'
import { ERC20__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory'
import {
  DepositInitiatedEvent,
  L1ERC20Gateway,
} from '@arbitrum/sdk/dist/lib/abi/L1ERC20Gateway'
import { L1ERC20Gateway__factory } from '@arbitrum/sdk/dist/lib/abi/factories/L1ERC20Gateway__factory'
import * as fs from 'fs'
import * as path from 'path'
import yargs from 'yargs'
import winston from 'winston'
import {
  ARB_MINIMUM_BLOCK_TIME_IN_SECONDS,
  SEVEN_DAYS_IN_SECONDS,
} from '@arbitrum/sdk/dist/lib/dataEntities/constants'
import { getExplorerUrlPrefixes, reportFailedTicket } from './report_retryables'

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
  enableAlerting: boolean
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

const checkNetworkAlreadyExistsInSdk = async (networkId: number) => {
  try {
    await getL2Network(networkId)
    return true
  } catch (_) {
    return false
  }
}

// Parsing command line arguments using yargs
const options: findRetryablesOptions = yargs(process.argv.slice(2))
  .options({
    fromBlock: { type: 'number', default: 0 },
    toBlock: { type: 'number', default: 0 },
    continuous: { type: 'boolean', default: false },
    configPath: { type: 'string', default: 'config.json' },
    enableAlerting: { type: 'boolean', default: false },
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
    const networkAlreadyExistsInSdk = await checkNetworkAlreadyExistsInSdk(
      childChain.chainID
    )
    if (!networkAlreadyExistsInSdk) {
      addCustomNetwork({ customL2Network: childChain })
    }
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

  // get deposit initiated event data
  const getDepositInitiatedEventData = async (
    parentChainGatewayAddress: string,
    filter: {
      fromBlock: providers.BlockTag
      toBlock: providers.BlockTag
    },
    parentChainProvider: providers.Provider
  ) => {
    const eventFetcher = new EventFetcher(parentChainProvider)
    const logs = await eventFetcher.getEvents<
      L1ERC20Gateway,
      DepositInitiatedEvent
    >(L1ERC20Gateway__factory, (g: any) => g.filters.DepositInitiated(), {
      ...filter,
      address: parentChainGatewayAddress,
    })

    return logs
  }

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

        // if no `fromBlock` or `toBlock` is provided, monitor for 14 days worth of blocks only
        if (fromBlock === 0) {
          fromBlock =
            toBlock -
            (2 * SEVEN_DAYS_IN_SECONDS) /
              (childChain.blockTime ?? ARB_MINIMUM_BLOCK_TIME_IN_SECONDS)
        }
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
      childChain.tokenBridge.l1ERC20Gateway,
      fromBlock,
      toBlock
    )

    return toBlock
  }

  const checkRetryables = async (
    parentChainProvider: providers.Provider,
    childChainProvider: providers.Provider,
    bridgeAddress: string,
    erc20GatewayAddress: string,
    fromBlock: number,
    toBlock: number
  ): Promise<boolean> => {
    const messageDeliveredLogs = await getMessageDeliveredEventData(
      bridgeAddress,
      { fromBlock, toBlock },
      parentChainProvider
    )

    const depositsInitiatedLogs = await getDepositInitiatedEventData(
      erc20GatewayAddress,
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

      const { PARENT_CHAIN_TX_PREFIX, CHILD_CHAIN_TX_PREFIX } =
        getExplorerUrlPrefixes(childChain)

      if (messages.length > 0) {
        logResult(
          childChain.name,
          `${messages.length} retryable${
            messages.length === 1 ? '' : 's'
          } found for ${
            childChain.name
          } chain. Checking their status:\n\nArbtxhash: ${
            PARENT_CHAIN_TX_PREFIX + parentTxHash
          }`
        )
        console.log(
          '----------------------------------------------------------'
        )
        for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
          const message = messages[msgIndex]
          const retryableTicketId = message.retryableCreationId
          let status = await message.status()

          if (
            options.enableAlerting &&
            status !== L1ToL2MessageStatus.REDEEMED
          ) {
            const childChainTx = await childChainProvider.getTransaction(
              retryableTicketId
            )
            const childChainTxReceipt =
              await childChainProvider.getTransactionReceipt(
                message.retryableCreationId
              )

            const timestamp = (
              await childChainProvider.getBlock(childChainTxReceipt.blockNumber)
            ).timestamp

            const parentChainTicketReport = {
              id: arbParentTxReceipt.transactionHash,
              transactionHash: arbParentTxReceipt.transactionHash,
              sender: arbParentTxReceipt.from,
              retryableTicketID: message.retryableCreationId,
            }

            let parentChainErc20Address: string | undefined,
              tokenAmount: string | undefined,
              tokenDepositData: any
            try {
              const retryableMessageData = childChainTx.data
              const retryableBody = retryableMessageData.split('0xc9f95d32')[1]
              const requestId = '0x' + retryableBody.slice(0, 64)
              const depositsInitiatedEvent = depositsInitiatedLogs.find(
                log => log.topics[3] === requestId
              )
              parentChainErc20Address = depositsInitiatedEvent?.event[0]
              tokenAmount = depositsInitiatedEvent?.event[4]?.toString()
            } catch (e) {
              console.log(e)
            }

            if (parentChainErc20Address) {
              try {
                const erc20 = ERC20__factory.connect(
                  parentChainErc20Address,
                  parentChainProvider
                )
                const [symbol, decimals] = await Promise.all([
                  erc20.symbol(),
                  erc20.decimals(),
                ])
                tokenDepositData = {
                  l2TicketId: message.retryableCreationId,
                  tokenAmount,
                  sender: arbParentTxReceipt.from,
                  l1Token: {
                    symbol,
                    decimals,
                    id: parentChainErc20Address,
                  },
                }
              } catch (e) {
                console.log('failed to fetch token data', e)
              }
            }

            const childChainTicketReport = {
              id: message.retryableCreationId,
              retryTxHash: message.retryableCreationId,
              createdAtTimestamp: String(timestamp),
              createdAtBlockNumber: childChainTxReceipt.blockNumber,
              timeoutTimestamp: String(
                Number(timestamp) + SEVEN_DAYS_IN_SECONDS
              ),
              deposit: String(message.messageData.l2CallValue), // eth amount
              status: L1ToL2MessageStatus[status],
              retryTo: childChainTxReceipt.to,
              retryData: message.messageData.data,
              gasFeeCap: (
                childChainTx.maxFeePerGas ?? BigNumber.from(0)
              ).toNumber(),
              gasLimit: childChainTx.gasLimit.toNumber(),
            }

            reportFailedTicket({
              parentChainTicketReport,
              childChainTicketReport,
              tokenDepositData,
              childChain,
            })
          }

          // Format the result message
          const resultMessage = `${msgIndex + 1}. ${
            ParentToChildMessageStatus[status]
          }:\nOrbitTxHash: ${CHILD_CHAIN_TX_PREFIX + retryableTicketId}`

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
  // log the chains being processed for better debugging in github actions
  console.log(
    '>>>>>> Processing child chains: ',
    config.childChains.map((childChain: ChildNetwork) => ({
      name: childChain.name,
      chainID: childChain.chainID,
      orbitRpcUrl: childChain.orbitRpcUrl,
      parentRpcUrl: childChain.parentRpcUrl,
    }))
  )

  const promises = config.childChains.map(
    async (childChain: ChildNetwork) =>
      await processChildChain(childChain, options)
  )

  // keep running the script until we get resolution (success or error) for all the chains
  await Promise.allSettled(promises)
}

// Start processing child chains concurrently
processOrbitChainsConcurrently()
