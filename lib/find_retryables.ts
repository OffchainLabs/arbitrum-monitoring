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

const options: findRetryablesOptions = yargs(process.argv.slice(2))
  .options({
    fromBlock: { type: 'number', default: 0 },
    toBlock: { type: 'number', default: 0 },
    continuous: { type: 'boolean', default: false },
    configPath: { type: 'string', default: 'config.json' },
  })
  .parseSync() as findRetryablesOptions

const processChildChain = async (
  childChain: ChildNetwork,
  options: findRetryablesOptions
) => {
  console.log('Running for Orbit chain:', childChain.name)
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

    return await checkRetryables(
      parentChainProvider,
      childChainProvider,
      childChain.ethBridge.inbox,
      fromBlock,
      toBlock
    )
  }

  const checkRetryables = async (
    parentChainProvider: providers.Provider,
    childChainProvider: providers.Provider,
    bridgeAddress: string,
    fromBlock: number,
    toBlock: number
  ) => {
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
        console.log(
          `${messages.length} retryable${
            messages.length === 1 ? '' : 's'
          } found for ${
            childChain.name
          } chain.\nChecking their status. Arbtxhash: ${
            childChain.parentExplorerUrl
          }/tx/${parentTxHash}`
        )

        console.log('************************************************')

        for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
          const message = messages[msgIndex]
          const retryableTicketId = message.retryableCreationId
          let status = await message.status()

          if (status === ParentToChildMessageStatus.NOT_YET_CREATED) {
            console.log(`Ticket still not created:\narbTxHash: ${parentTxHash}`)
          } else if (status === ParentToChildMessageStatus.CREATION_FAILED) {
            console.log(
              `☠️ Severe error: Retryable ticket creation failed:\norbitTxHash: ${childChain.explorerUrl}/tx/${retryableTicketId}`
            )
          } else if (
            status === ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_L2
          ) {
            console.log(
              `⚠️ Ticket Not redeemed:\norbitTxHash: ${childChain.explorerUrl}/tx/${retryableTicketId}`
            )
          } else if (status === ParentToChildMessageStatus.EXPIRED) {
            console.log(
              `Ticket expired (!):\norbitTxHash: ${childChain.explorerUrl}/tx/${retryableTicketId}`
            )
          } else if (status === ParentToChildMessageStatus.REDEEMED) {
            console.log(
              `Ticket is successfully redeemed:\norbitTxHash: ${childChain.explorerUrl}/tx/${retryableTicketId}`
            )
            console.log('')
          }
        }
      }
    }
    return toBlock
  }

  const checkRetryablesContinuous = async () => {
    let isContinuous = options.continuous
    let fromBlock = options.fromBlock
    let toBlock = options.toBlock

    while (isContinuous) {
      const lastBlockChecked = await checkRetryablesOneOff(fromBlock, toBlock)
      isContinuous = options.continuous
      fromBlock = lastBlockChecked
      toBlock = 0
      await new Promise(resolve => setTimeout(resolve, 30 * 60 * 1000)) // 30 minutes delay
    }
  }

  if (options.continuous) {
    await checkRetryablesContinuous()
  } else {
    await checkRetryablesOneOff(options.fromBlock, options.toBlock)
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

const nameprocessOrbitChainsConcurrently = async () => {
  const promises = config.childChains.map((childChain: ChildNetwork) =>
    processChildChain(childChain, options)
  )

  await Promise.all(promises)
}

nameprocessOrbitChainsConcurrently()
