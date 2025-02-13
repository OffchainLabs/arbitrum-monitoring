import * as fs from 'fs'
import * as path from 'path'
import yargs from 'yargs'
import winston from 'winston'
import { BigNumber, providers } from 'ethers'
import {
  EventFetcher,
  getArbitrumNetwork,
  registerCustomArbitrumNetwork,
  ParentTransactionReceipt,
  ParentToChildMessageStatus,
  ParentToChildMessageReader,
} from '@arbitrum/sdk'
import { Provider, TransactionReceipt } from '@ethersproject/abstract-provider'
import { FetchedEvent } from '@arbitrum/sdk/dist/lib/utils/eventFetcher'
import { TypedEvent } from '@arbitrum/sdk/dist/lib/abi/common'
import { Bridge__factory } from '@arbitrum/sdk/dist/lib/abi/factories/Bridge__factory'
import { ERC20__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory'
import {
  DepositInitiatedEvent,
  L1ERC20Gateway,
} from '@arbitrum/sdk/dist/lib/abi/L1ERC20Gateway'
import { L1ERC20Gateway__factory } from '@arbitrum/sdk/dist/lib/abi/factories/L1ERC20Gateway__factory'
import {
  ARB_MINIMUM_BLOCK_TIME_IN_SECONDS,
  SEVEN_DAYS_IN_SECONDS,
} from '@arbitrum/sdk/dist/lib/dataEntities/constants'
import { reportFailedTicket } from './reportRetryables'
import { reportRetryableErrorToSlack } from './reportRetryableErrorToSlack'
import {
  ChildChainTicketReport,
  FindRetryablesOptions,
  ParentChainTicketReport,
  TokenDepositData,
} from './types'
import {
  ChildNetwork,
  DEFAULT_CONFIG_PATH,
  getConfig,
  getExplorerUrlPrefixes,
} from '../utils'

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

const getParentChainBlockTime = (childChain: ChildNetwork) => {
  const parentChainId = childChain.parentChainId

  // for Ethereum / Sepolia / Holesky
  if (
    parentChainId === 1 ||
    parentChainId === 11155111 ||
    parentChainId === 17000
  ) {
    return 12
  }

  // for Base / Base Sepolia
  if (parentChainId === 8453 || parentChainId === 84532) {
    return 2
  }

  // for arbitrum networks, return the standard block time
  return ARB_MINIMUM_BLOCK_TIME_IN_SECONDS
}

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

  const MAX_BLOCKS_TO_PROCESS = 5000 // event_logs can only be processed in batches of MAX_BLOCKS_TO_PROCESS blocks

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
        // only enforce `fromBlock` check if we want to report the ticket to the alerting system
        if (fromBlock === 0 && options.enableAlerting) {
          fromBlock =
            toBlock -
            (2 * SEVEN_DAYS_IN_SECONDS) / getParentChainBlockTime(childChain)
          logResult(
            childChain.name,
            `Alerting mode enabled: limiting block-range to last 14 days [${fromBlock} to ${toBlock}]`
          )
        }
      } catch (error) {
        console.error(
          `Error getting the latest block: ${(error as Error).message}`
        )
        throw error
      }
    }

    // if the block range provided is >=MAX_BLOCKS_TO_PROCESS, we might get rate limited while fetching logs from the node
    // so we break down the range into smaller chunks and process them sequentially
    // generate the final ranges' batches to process [ [fromBlock, toBlock], [fromBlock, toBlock], ...]
    const ranges = []
    for (let i = fromBlock; i <= toBlock; i += MAX_BLOCKS_TO_PROCESS) {
      ranges.push([i, Math.min(i + MAX_BLOCKS_TO_PROCESS - 1, toBlock)])
    }

    for (const range of ranges) {
      retryablesFound =
        (await checkRetryables(
          parentChainProvider,
          childChainProvider,
          childChain.ethBridge.bridge,
          range[0],
          range[1]
        )) || retryablesFound // the final `retryablesFound` value is the OR of all the `retryablesFound` for ranges
    }

    return toBlock
  }

  const getParentChainTicketReport = (
    arbParentTxReceipt: ParentTransactionReceipt,
    retryableMessage: ParentToChildMessageReader
  ): ParentChainTicketReport => {
    return {
      id: arbParentTxReceipt.transactionHash,
      transactionHash: arbParentTxReceipt.transactionHash,
      sender: arbParentTxReceipt.from,
      retryableTicketID: retryableMessage.retryableCreationId,
    }
  }

  const getChildChainTicketReport = async ({
    childChainTx,
    childChainTxReceipt,
    retryableMessage,
  }: {
    childChainTx: providers.TransactionResponse
    childChainTxReceipt: TransactionReceipt
    retryableMessage: ParentToChildMessageReader
  }): Promise<ChildChainTicketReport> => {
    let status = await retryableMessage.status()

    const timestamp = (
      await childChainProvider.getBlock(childChainTxReceipt.blockNumber)
    ).timestamp

    const childChainTicketReport = {
      id: retryableMessage.retryableCreationId,
      retryTxHash: (await retryableMessage.getAutoRedeemAttempt())
        ?.transactionHash,
      createdAtTimestamp: String(timestamp),
      createdAtBlockNumber: childChainTxReceipt.blockNumber,
      timeoutTimestamp: String(Number(timestamp) + SEVEN_DAYS_IN_SECONDS),
      deposit: String(retryableMessage.messageData.l2CallValue), // eth amount
      status: ParentToChildMessageStatus[status],
      retryTo: childChainTxReceipt.to,
      retryData: retryableMessage.messageData.data,
      gasFeeCap: (childChainTx.maxFeePerGas ?? BigNumber.from(0)).toNumber(),
      gasLimit: childChainTx.gasLimit.toNumber(),
    }

    return childChainTicketReport
  }

  const getTokenDepositData = async ({
    childChainTx,
    retryableMessage,
    arbParentTxReceipt,
    depositsInitiatedLogs,
  }: {
    childChainTx: providers.TransactionResponse
    retryableMessage: ParentToChildMessageReader
    arbParentTxReceipt: ParentTransactionReceipt
    depositsInitiatedLogs: FetchedEvent<TypedEvent<any, any>>[]
  }): Promise<TokenDepositData | undefined> => {
    let parentChainErc20Address: string | undefined,
      tokenAmount: string | undefined,
      tokenDepositData: TokenDepositData | undefined

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
          l2TicketId: retryableMessage.retryableCreationId,
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

    return tokenDepositData
  }

  const getDepositInitiatedLogs = async ({
    fromBlock,
    toBlock,
    parentChainProvider,
  }: {
    fromBlock: number
    toBlock: number
    parentChainProvider: Provider
  }) => {
    const [
      depositsInitiatedLogsL1Erc20Gateway,
      depositsInitiatedLogsL1CustomGateway,
      depositsInitiatedLogsL1WethGateway,
    ] = await Promise.all(
      [
        childChain.tokenBridge!.parentErc20Gateway,
        childChain.tokenBridge!.parentCustomGateway,
        childChain.tokenBridge!.parentWethGateway,
      ].map(gatewayAddress => {
        return getDepositInitiatedEventData(
          gatewayAddress,
          { fromBlock, toBlock },
          parentChainProvider
        )
      })
    )

    return [
      ...depositsInitiatedLogsL1Erc20Gateway,
      ...depositsInitiatedLogsL1CustomGateway,
      ...depositsInitiatedLogsL1WethGateway,
    ]
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

    // used for finding the token-details associated with a deposit, if any
    const depositsInitiatedLogs = await getDepositInitiatedLogs({
      fromBlock,
      toBlock,
      parentChainProvider,
    })

    const uniqueTxHashes = new Set<string>()
    for (let messageDeliveredLog of messageDeliveredLogs) {
      const { transactionHash: parentTxHash } = messageDeliveredLog
      uniqueTxHashes.add(parentTxHash)
    }

    // for each parent-chain-transaction found, extract the Retryables thus created by it
    for (const parentTxHash of uniqueTxHashes) {
      const parentTxReceipt = await parentChainProvider.getTransactionReceipt(
        parentTxHash
      )
      const arbParentTxReceipt = new ParentTransactionReceipt(parentTxReceipt)
      const retryables = await arbParentTxReceipt.getParentToChildMessages(
        childChainProvider
      )

      const { PARENT_CHAIN_TX_PREFIX, CHILD_CHAIN_TX_PREFIX } =
        getExplorerUrlPrefixes(childChain)

      if (retryables.length > 0) {
        logResult(
          childChain.name,
          `${retryables.length} retryable${
            retryables.length === 1 ? '' : 's'
          } found for ${
            childChain.name
          } chain. Checking their status:\n\nParentChainTxHash: ${
            PARENT_CHAIN_TX_PREFIX + parentTxHash
          }`
        )
        console.log(
          '----------------------------------------------------------'
        )

        // for each retryable, extract the detail for it's status / redemption
        for (let msgIndex = 0; msgIndex < retryables.length; msgIndex++) {
          const retryableMessage = retryables[msgIndex]
          const retryableTicketId = retryableMessage.retryableCreationId
          let status = await retryableMessage.status()

          // if a Retryable is not in a successful state, extract it's details
          if (status !== ParentToChildMessageStatus.REDEEMED) {
            // report the ticket only if `enableAlerting` flag is on
            if (options.enableAlerting) {
              const childChainTx = await childChainProvider.getTransaction(
                retryableTicketId
              )
              const childChainTxReceipt =
                await childChainProvider.getTransactionReceipt(
                  retryableMessage.retryableCreationId
                )

              if (!childChainTxReceipt) {
                // if child-chain tx is very recent, the tx receipt might not be found yet
                // if not handled, this will result in `undefined` error while trying to extract retryable details
                const resultMessage = `${msgIndex + 1}. ${
                  ParentToChildMessageStatus[status]
                }:\nChildChainTxHash: ${
                  CHILD_CHAIN_TX_PREFIX + retryableTicketId
                } (Receipt not found yet)`
                logResult(childChain.name, resultMessage)

                continue
              }

              const parentChainTicketReport = getParentChainTicketReport(
                arbParentTxReceipt,
                retryableMessage
              )
              const childChainTicketReport = await getChildChainTicketReport({
                retryableMessage,
                childChainTx,
                childChainTxReceipt,
              })
              const tokenDepositData = await getTokenDepositData({
                childChainTx,
                retryableMessage,
                arbParentTxReceipt,
                depositsInitiatedLogs,
              })

              // report the unsuccessful ticket to the alerting system
              await reportFailedTicket({
                parentChainTicketReport,
                childChainTicketReport,
                tokenDepositData,
                childChain,
              })
            }
          }

          // format the result message
          const resultMessage = `${msgIndex + 1}. ${
            ParentToChildMessageStatus[status]
          }:\nChildChainTxHash: ${CHILD_CHAIN_TX_PREFIX + retryableTicketId}`
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
        reportRetryableErrorToSlack({
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
