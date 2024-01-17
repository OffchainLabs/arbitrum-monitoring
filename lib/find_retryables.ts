import { providers } from 'ethers'
import { Provider } from '@ethersproject/abstract-provider'
import { BlockTag } from '@ethersproject/abstract-provider'
require('dotenv').config()
import * as fs from 'fs'
import * as path from 'path' // Import the 'path' module
import yargs from 'yargs'


import {
  EventFetcher,
  addCustomNetwork,
  L1TransactionReceipt as ParentChainTxReceipt,
  L1ToL2MessageStatus as ParentToChildMessageStatus,
  L2Network as ParentNetwork,
} from '@arbitrum/sdk'

import { Inbox__factory } from '@arbitrum/sdk/dist/lib/abi/factories/Inbox__factory'

export interface ChildNetwork extends ParentNetwork {
  parentRpcUrl: string
  orbitRpcUrl: string
}

// Specify the absolute path to the config.json file
const configFileContent = fs.readFileSync(
  path.join(__dirname, 'config.json'),
  'utf-8'
)
const config = JSON.parse(configFileContent)
const networkConfig: ChildNetwork = config.childChain

const parentChainProvider = new providers.JsonRpcProvider(
  String(networkConfig.parentRpcUrl)
)
const childChainProvider = new providers.JsonRpcProvider(
  String(networkConfig.orbitRpcUrl)
)

// Defining options for finding retryable transactions
type findRetryablesOptions = {
  fromBlock: number
  toBlock: number
}

const main = async (childChain: ChildNetwork, options: findRetryablesOptions) => {
  // Adding your Obit chain as a custom chain to the Arbitrum SDK
  try {
    addCustomNetwork({ customL2Network: childChain })
  } catch (error: any) {
    console.error(`Failed to register the child network: ${error.message}`)
  }

  // Function to retrieve events related to Inbox
  const getInboxMessageDeliveredEventData = async (
    parentInboxAddress: string,
    filter: {
      fromBlock: BlockTag
      toBlock: BlockTag
    },
    parentChainProvider: Provider
  ) => {
    const eventFetcher = new EventFetcher(parentChainProvider)
    const logs = await eventFetcher.getEvents(
      Inbox__factory,
      (g: any) => g.filters.InboxMessageDelivered(),
      { ...filter, address: parentInboxAddress }
    )
    return logs
  }

  // Function to check and process the retryables
  const checkRetryablesOneOff = async () => {
    const fromBlock = options.fromBlock
    let toBlock = options.toBlock

    if (toBlock === 0) {
      try {
        const currentBlock = await parentChainProvider.getBlockNumber()
        toBlock = currentBlock
      } catch (error) {
        console.error(`Error getting the latest block: ${error.message}`)
        // Set a default value if the latest block retrieval fails
        toBlock = 0
      }
    }

    await checkRetryables(
      parentChainProvider,
      childChainProvider,
      childChain.ethBridge.inbox,
      fromBlock,
      toBlock
    )
  }

  const checkRetryables = async (
    parentChainProvider: Provider,
    childChainProvider: Provider,
    bridgeAddress: string,
    fromBlock: number,
    toBlock: number
  ) => {
    let inboxDeliveredLogs

    inboxDeliveredLogs = await getInboxMessageDeliveredEventData(
      bridgeAddress,
      { fromBlock, toBlock },
      parentChainProvider
    )
    // Create a set to store unique transaction hashes
    const uniqueTxHashes = new Set<string>()

    // Iterate through inboxDeliveredLogs and add unique transaction hashes to the set
    for (let inboxDeliveredLog of inboxDeliveredLogs) {
      if (inboxDeliveredLog.data.length === 706) continue // depositETH bypass
      const { transactionHash: parentTxHash } = inboxDeliveredLog
      uniqueTxHashes.add(parentTxHash)
    }

    // Iterate through unique transaction hashes
    for (const parentTxHash of uniqueTxHashes) {
      const parentTxReceipt = await parentChainProvider.getTransactionReceipt(parentTxHash)

      const arbParentTxReceipt = new ParentChainTxReceipt(parentTxReceipt)

      const messages = await arbParentTxReceipt.getL1ToL2Messages(childChainProvider)

      if (messages.length == 0) {
        break
      } else {
        console.log(
          `${messages.length} retryable${
            messages.length === 1 ? '' : 's'
          } found, checking their status. Arbtxhash: ${process.env
            .ARBISCAN!}${parentTxHash}`
        )
        console.log('************************************************')

        for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
          const message = messages[msgIndex]
          const retryableTicketId = message.retryableCreationId

          let status = await message.status()
          // Logging different statuses of L2-to-L3 messages
          if (status === ParentToChildMessageStatus.NOT_YET_CREATED) {
            console.log(`Ticket still not created:\narbTxHash: ${parentTxHash}`)
          } else if (status === ParentToChildMessageStatus.CREATION_FAILED) {
            console.log(
              `☠️ Severe error: Retryable ticket creation failed:\norbitTxHash: ${childChain.explorerUrl}/tx/${retryableTicketId}`
            )
          } else if (status === ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_L2) {
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
  }
  await checkRetryablesOneOff()
}

// Parsing command line arguments
const options = yargs(process.argv.slice(2))
  .options({
    fromBlock: { type: 'number', default: 0 },
    toBlock: { type: 'number', default: 0 },
  })
  .parseSync()

// Calling the main function with the provided options
main(networkConfig, options)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
