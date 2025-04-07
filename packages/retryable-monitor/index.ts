import * as fs from 'fs'
import { Client } from '@notionhq/client'
import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'
import { QueryDatabaseResponse } from '@notionhq/client/build/src/api-endpoints'
import yargs from 'yargs'
import { ethers } from 'ethers'
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
import { syncTicketToNotion } from './notion/syncTicket'
import { getTokenPrice } from './reportRetryables'
import { getGasInfo } from './reportRetryables'
import { formatL2Callvalue } from './reportRetryables'
import { getNotionTicketStatus } from './notion/queryTicket'

const logFilePath = 'logfile.log'

try {
  fs.accessSync(logFilePath)
} catch (error) {
  try {
    fs.writeFileSync(logFilePath, '')
  } catch (createError) {
    console.error(`Error creating log file: ${(createError as Error).message}`)
    process.exit(1)
  }
}

const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: logFilePath }),
  ],
})

const logResult = (chainName: string, message: string) => {
  logger.info(`[${chainName}] ${message}`)
}

const runSweep = async () => {
  const notion = new Client({
    auth: process.env.RETRYABLE_MONITORING_NOTION_TOKEN,
  })
  const dbId = process.env.RETRYABLE_MONITORING_NOTION_DB_ID!
  const now = Date.now()

  const STATUS_SKIP = ['Resolved', 'Expired', 'False Positive']
  const STATUS_ALERT_ELIGIBLE = ['Untriaged', 'Investigating']
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

  const pages: PageObjectResponse[] = []
  let cursor = undefined

  do {
    const response: QueryDatabaseResponse = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
    })
    pages.push(...(response.results as PageObjectResponse[]))
    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)

  for (const ticket of pages) {
    const props = ticket.properties as any
    const status = props.Status?.select?.name
    const timeout = props.timeout?.number
    const id = props.ID?.rich_text?.[0]?.plain_text

    if (!id || !timeout || STATUS_SKIP.includes(status)) continue

    const timeRemaining = timeout - now

    if (timeRemaining < 0 && status !== 'Expired') {
      await notion.pages.update({
        page_id: ticket.id,
        properties: {
          Status: {
            select: { name: 'Expired' },
          },
        },
      })
      console.log(`⏳ Ticket ${id} marked as Expired`)
      continue
    }

    if (
      timeRemaining < TWENTY_FOUR_HOURS_MS &&
      STATUS_ALERT_ELIGIBLE.includes(status)
    ) {
      await reportRetryableErrorToSlack({
        message: `🚨 Ticket ${id} is about to expire in ${Math.round(
          timeRemaining / 3600000
        )} hours`,
      })
      console.log(`⚠️ Alert sent for ticket ${id}`)
    }
  }
}

const startSweepLoop = async () => {
  const HOUR_MS = 60 * 60 * 1000

  while (true) {
    console.log('🌀 Starting DB sweep...')
    try {
      await runSweep()
    } catch (e) {
      console.error('❌ Error during sweep:', e)
    }
    console.log('✅ Sweep done. Sleeping for 1 hour...\n')
    await new Promise(resolve => setTimeout(resolve, HOUR_MS))
  }
}

const getParentChainBlockTime = (childChain: ChildNetwork) => {
  const parentChainId = childChain.parentChainId
  if ([1, 11155111, 17000].includes(parentChainId)) return 12
  if ([8453, 84532].includes(parentChainId)) return 2
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

const options: FindRetryablesOptions = yargs(process.argv.slice(2))
  .options({
    fromBlock: { type: 'number', default: 0 },
    toBlock: { type: 'number', default: 0 },
    continuous: { type: 'boolean', default: false },
    configPath: { type: 'string', default: DEFAULT_CONFIG_PATH },
    enableAlerting: { type: 'boolean', default: false },
    writeToNotion: { type: 'boolean', default: false },
  })
  .strict()
  .parseSync() as FindRetryablesOptions

const config = getConfig({ configPath: options.configPath })

const processChildChain = async (
  childChain: ChildNetwork,
  options: FindRetryablesOptions
) => {
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

  const getDepositInitiatedEventData = async (
    parentChainGatewayAddress: string,
    filter: {
      fromBlock: providers.BlockTag
      toBlock: providers.BlockTag
    },
    parentChainProvider: providers.Provider
  ) => {
    const eventFetcher = new EventFetcher(parentChainProvider)
    return await eventFetcher.getEvents<L1ERC20Gateway, DepositInitiatedEvent>(
      L1ERC20Gateway__factory,
      (g: any) => g.filters.DepositInitiated(),
      {
        ...filter,
        address: parentChainGatewayAddress,
      }
    )
  }

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
    return logs.filter(log => log.event.kind === 9)
  }

  const MAX_BLOCKS_TO_PROCESS = 5000

  const checkRetryablesOneOff = async (
    fromBlock: number,
    toBlock: number
  ): Promise<number> => {
    if (toBlock === 0) {
      const currentBlock = await parentChainProvider.getBlockNumber()
      if (!currentBlock) throw new Error('Failed to retrieve the latest block.')
      toBlock = currentBlock
      if (fromBlock === 0 && options.enableAlerting) {
        fromBlock =
          toBlock -
          (2 * SEVEN_DAYS_IN_SECONDS) / getParentChainBlockTime(childChain)
        logResult(
          childChain.name,
          `Alerting mode enabled: limiting block-range to last 14 days [${fromBlock} to ${toBlock}]`
        )
      }
    }

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
        )) || retryablesFound
    }

    return toBlock
  }

  const getParentChainTicketReport = (
    arbParentTxReceipt: ParentTransactionReceipt,
    retryableMessage: ParentToChildMessageReader
  ): ParentChainTicketReport => ({
    id: arbParentTxReceipt.transactionHash,
    transactionHash: arbParentTxReceipt.transactionHash,
    sender: arbParentTxReceipt.from,
    retryableTicketID: retryableMessage.retryableCreationId,
  })

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
    return {
      id: retryableMessage.retryableCreationId,
      retryTxHash: (await retryableMessage.getAutoRedeemAttempt())
        ?.transactionHash,
      createdAtTimestamp: String(timestamp),
      createdAtBlockNumber: childChainTxReceipt.blockNumber,
      timeoutTimestamp: String(Number(timestamp) + SEVEN_DAYS_IN_SECONDS),
      deposit: String(retryableMessage.messageData.l2CallValue),
      status: ParentToChildMessageStatus[status],
      retryTo: retryableMessage.messageData.destAddress,
      retryData: retryableMessage.messageData.data,
      gasFeeCap: (childChainTx.maxFeePerGas ?? BigNumber.from(0)).toNumber(),
      gasLimit: childChainTx.gasLimit.toNumber(),
    }
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
      const retryableBody = childChainTx.data.split('0xc9f95d32')[1]
      const requestId = '0x' + retryableBody.slice(0, 64)
      const depositsInitiatedEvent = depositsInitiatedLogs.find(
        log => log.topics[3] === requestId
      )
      parentChainErc20Address = depositsInitiatedEvent?.event[0]
      tokenAmount = depositsInitiatedEvent?.event[4]?.toString()
    } catch (_) {}

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
      } catch (_) {}
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
    const [a, b, c] = await Promise.all(
      [
        childChain.tokenBridge!.parentErc20Gateway,
        childChain.tokenBridge!.parentCustomGateway,
        childChain.tokenBridge!.parentWethGateway,
      ].map(addr =>
        getDepositInitiatedEventData(
          addr,
          { fromBlock, toBlock },
          parentChainProvider
        )
      )
    )
    return [...a, ...b, ...c]
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
    const depositsInitiatedLogs = await getDepositInitiatedLogs({
      fromBlock,
      toBlock,
      parentChainProvider,
    })

    const uniqueTxHashes = new Set(
      messageDeliveredLogs.map(log => log.transactionHash)
    )

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
          }. Checking their status:\n\nParentChainTxHash: ${
            PARENT_CHAIN_TX_PREFIX + parentTxHash
          }`
        )

        for (let msgIndex = 0; msgIndex < retryables.length; msgIndex++) {
          const retryableMessage = retryables[msgIndex]
          const status = await retryableMessage.status()
          const childChainTx = await childChainProvider.getTransaction(
            retryableMessage.retryableCreationId
          )
          const childChainTxReceipt =
            await childChainProvider.getTransactionReceipt(
              retryableMessage.retryableCreationId
            )

          if (!childChainTxReceipt) {
            const resultMessage = `${msgIndex + 1}. ${
              ParentToChildMessageStatus[status]
            }:\nChildChainTxHash: ${CHILD_CHAIN_TX_PREFIX}${
              retryableMessage.retryableCreationId
            }} (Receipt not found yet)`
            logResult(childChain.name, resultMessage)
            continue
          }

          const childChainTicketReport = await getChildChainTicketReport({
            retryableMessage,
            childChainTx,
            childChainTxReceipt,
          })

          const formattedCallValueFull = await formatL2Callvalue(
            childChainTicketReport,
            childChain,
            parentChainProvider
          )

          const l2CallValueFormatted = formattedCallValueFull
            .replace('\n\t *Child chain callvalue:* ', '')
            .trim()

          // Already in your code
          const tokenDepositData = await getTokenDepositData({
            childChainTx,
            retryableMessage,
            arbParentTxReceipt,
            depositsInitiatedLogs,
          })

          let formattedTokenString: string | undefined = undefined
          if (tokenDepositData?.tokenAmount && tokenDepositData?.l1Token) {
            const amount = BigNumber.from(tokenDepositData.tokenAmount)
            const decimals = tokenDepositData.l1Token.decimals
            const symbol = tokenDepositData.l1Token.symbol
            const address = tokenDepositData.l1Token.id

            const humanAmount = Number(amount) / 10 ** decimals
            const price = (await getTokenPrice(address)) ?? 1
            const usdValue = humanAmount * price

            formattedTokenString = `${humanAmount.toFixed(
              6
            )} ${symbol} ($${usdValue.toFixed(2)}) (${address})`
          }
          const { l2GasPrice, l2GasPriceAtCreation } = await getGasInfo(
            childChainTicketReport.createdAtBlockNumber,
            retryableMessage.retryableCreationId,
            childChainProvider
          )

          const gasPriceProvided = `${ethers.utils.formatUnits(
            childChainTicketReport.gasFeeCap,
            'gwei'
          )} gwei`
          const gasPriceAtCreation = l2GasPriceAtCreation
            ? `${ethers.utils.formatUnits(l2GasPriceAtCreation, 'gwei')} gwei`
            : undefined
          const gasPriceNow = `${ethers.utils.formatUnits(
            l2GasPrice,
            'gwei'
          )} gwei`

          if (
            status !== ParentToChildMessageStatus.REDEEMED &&
            options.writeToNotion
          ) {
            await syncTicketToNotion({
              childChainTxHash: `${CHILD_CHAIN_TX_PREFIX}${retryableMessage.retryableCreationId}`,
              parentChainTxHash: `${PARENT_CHAIN_TX_PREFIX}${parentTxHash}`,
              createdAt:
                Number(childChainTicketReport.createdAtTimestamp) * 1000,
              status: 'Untriaged',
              priority: 'Unset',
              metadata: {
                tokensDeposited: formattedTokenString,
                gasPriceProvided,
                gasPriceAtCreation,
                gasPriceNow,
                l2CallValue: l2CallValueFormatted,
              },
            })
          }

          if (
            status !== ParentToChildMessageStatus.REDEEMED &&
            options.enableAlerting &&
            options.writeToNotion
          ) {
            const notionStatus = await getNotionTicketStatus(
              retryableMessage.retryableCreationId
            )

            if (!notionStatus || notionStatus === 'Untriaged') {
              const parentChainTicketReport = getParentChainTicketReport(
                arbParentTxReceipt,
                retryableMessage
              )

              const tokenDepositData = await getTokenDepositData({
                childChainTx,
                retryableMessage,
                arbParentTxReceipt,
                depositsInitiatedLogs,
              })

              await reportFailedTicket({
                parentChainTicketReport,
                childChainTicketReport,
                tokenDepositData,
                childChain,
              })
            }
          }

          const resultMessage = `${msgIndex + 1}. ${
            ParentToChildMessageStatus[status]
          }:\nChildChainTxHash: ${CHILD_CHAIN_TX_PREFIX}${
            retryableMessage.retryableCreationId
          }}`
          logResult(childChain.name, resultMessage)
        }
        retryablesFound = true
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
      fromBlock = lastBlockChecked + 1
      toBlock = await parentChainProvider.getBlockNumber()
      return lastBlockChecked
    }

    while (isContinuous) {
      const lastBlockChecked = await processBlocks()
      if (lastBlockChecked >= toBlock) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      const elapsedTimeInSeconds = Math.floor((Date.now() - startTime) / 1000)
      if (elapsedTimeInSeconds >= processingDurationInSeconds) {
        isContinuous = false
      }
    }
  }

  if (options.continuous) {
    await checkRetryablesContinuous(options.fromBlock, options.toBlock)
  } else {
    await checkRetryablesOneOff(options.fromBlock, options.toBlock)
    if (!retryablesFound) {
      logResult(childChain.name, `No retryables found for ${childChain.name}`)
    }
  }
}

const processOrbitChainsConcurrently = async () => {
  const promises = config.childChains.map(async (childChain: ChildNetwork) => {
    try {
      return await processChildChain(childChain, options)
    } catch (e) {
      const errorStr = `Retryable monitor - Error processing chain [${childChain.name}]: ${e.message}`
      if (options.enableAlerting) {
        reportRetryableErrorToSlack({ message: errorStr })
      }
      console.error(errorStr)
    }
  })
  await Promise.allSettled(promises)
}

const main = async () => {
  // Start chain processing loop (every 3 minutes)
  const orbitMonitorLoop = async () => {
    const INTERVAL_MS = 3 * 60 * 1000

    while (true) {
      console.log('🔁 Checking Orbit chains...')
      try {
        await processOrbitChainsConcurrently()
      } catch (e) {
        console.error('❌ Error in Orbit monitor:', e)
      }
      await new Promise(resolve => setTimeout(resolve, INTERVAL_MS))
    }
  }

  // Start Notion sweep loop (every 1 hour)
  const dbSweepLoop = async () => {
    const HOUR_MS = 60 * 60 * 1000

    while (true) {
      console.log('🧊 Sweeping DB for expired tickets...')
      try {
        await runSweep()
      } catch (e) {
        console.error('❌ Error in DB sweep:', e)
      }
      await new Promise(resolve => setTimeout(resolve, HOUR_MS))
    }
  }

  // Start both in parallel
  await Promise.all([orbitMonitorLoop(), dbSweepLoop()])
}

main()
