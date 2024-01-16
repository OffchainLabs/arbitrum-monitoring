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
  L1TransactionReceipt,
  L1ToL2MessageStatus,
  L2Network,
} from '@arbitrum/sdk'

import { Inbox__factory } from '@arbitrum/sdk/dist/lib/abi/factories/Inbox__factory'

export interface L3Network extends L2Network {
  parentRpcUrl: string
  orbitRpcUrl: string
}

// Specify the absolute path to the config.json file
const configFileContent = fs.readFileSync(
  path.join(__dirname, 'config.json'),
  'utf-8'
)
const config = JSON.parse(configFileContent)
const networkConfig: L3Network = config.l3Chain

const l2Provider = new providers.JsonRpcProvider(
  String(networkConfig.parentRpcUrl)
)
const l3Provider = new providers.JsonRpcProvider(
  String(networkConfig.orbitRpcUrl)
)

// Defining options for finding retryable transactions
type findRetryablesOptions = {
  fromBlock: number
  toBlock: number
}

const main = async (l3Chain: L3Network, options: findRetryablesOptions) => {
  // Adding your Obit chain as a custom chain to the Arbitrum SDK
  try {
    addCustomNetwork({ customL2Network: l3Chain })
  } catch (error: any) {
    console.error(`Failed to register the L3 network: ${error.message}`)
  }

  // Function to retrieve events related to Inbox
  const getInboxMessageDeliveredEventData = async (
    l2InboxAddress: string,
    filter: {
      fromBlock: BlockTag
      toBlock: BlockTag
    },
    l1Provider: Provider
  ) => {
    const eventFetcher = new EventFetcher(l1Provider)
    const logs = await eventFetcher.getEvents(
      Inbox__factory,
      (g: any) => g.filters.InboxMessageDelivered(),
      { ...filter, address: l2InboxAddress }
    )
    return logs
  }

  // Function to check and process the retryables
  const checkRetryablesOneOff = async () => {
    const fromBlock = options.fromBlock
    let toBlock = options.toBlock

    if (toBlock === 0) {
      try {
        const currentBlock = await l2Provider.getBlockNumber()
        toBlock = currentBlock
      } catch (error) {
        console.error(`Error getting the latest block: ${error.message}`)
        // Set a default value if the latest block retrieval fails
        toBlock = 0
      }
    }

    await checkRetryables(
      l2Provider,
      l3Provider,
      l3Chain.ethBridge.inbox,
      fromBlock,
      toBlock
    )
  }

  const checkRetryables = async (
    l2Provider: Provider,
    l3Provider: Provider,
    bridgeAddress: string,
    fromBlock: number,
    toBlock: number
  ) => {
    let inboxDeliveredLogs

    inboxDeliveredLogs = await getInboxMessageDeliveredEventData(
      bridgeAddress,
      { fromBlock, toBlock },
      l2Provider
    )
    // Create a set to store unique transaction hashes
    const uniqueTxHashes = new Set<string>()

    // Iterate through inboxDeliveredLogs and add unique transaction hashes to the set
    for (let inboxDeliveredLog of inboxDeliveredLogs) {
      if (inboxDeliveredLog.data.length === 706) continue // depositETH bypass
      const { transactionHash: l2TxHash } = inboxDeliveredLog
      uniqueTxHashes.add(l2TxHash)
    }

    // Iterate through unique transaction hashes
    for (const l2TxHash of uniqueTxHashes) {
      const l2TxReceipt = await l2Provider.getTransactionReceipt(l2TxHash)

      const arbL2TxReceipt = new L1TransactionReceipt(l2TxReceipt)

      const messages = await arbL2TxReceipt.getL1ToL2Messages(l3Provider)

      if (messages.length == 0) {
        break
      } else {
        console.log(
          `${messages.length} retryable${
            messages.length === 1 ? '' : 's'
          } found, checking their status. Arbtxhash: ${process.env
            .ARBISCAN!}${l2TxHash}`
        )
        console.log('************************************************')

        for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
          const message = messages[msgIndex]
          const retryableTicketId = message.retryableCreationId

          let status = await message.status()
          // Logging different statuses of L2-to-L3 messages
          if (status === L1ToL2MessageStatus.NOT_YET_CREATED) {
            console.log(`Ticket still not created:\narbTxHash: ${l2TxHash}`)
          } else if (status === L1ToL2MessageStatus.CREATION_FAILED) {
            console.log(
              `☠️ Severe error: Retryable ticket creation failed:\norbitTxHash: ${l3Chain.explorerUrl}/tx/${retryableTicketId}`
            )
          } else if (status === L1ToL2MessageStatus.FUNDS_DEPOSITED_ON_L2) {
            console.log(
              `⚠️ Ticket Not redeemed:\norbitTxHash: ${l3Chain.explorerUrl}/tx/${retryableTicketId}`
            )
          } else if (status === L1ToL2MessageStatus.EXPIRED) {
            console.log(
              `Ticket expired (!):\norbitTxHash: ${l3Chain.explorerUrl}/tx/${retryableTicketId}`
            )
          } else if (status === L1ToL2MessageStatus.REDEEMED) {
            console.log(
              `Ticket is successfully redeemed:\norbitTxHash: ${l3Chain.explorerUrl}/tx/${retryableTicketId}`
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
