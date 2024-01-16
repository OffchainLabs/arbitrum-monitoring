import { providers } from 'ethers'
import { Provider } from '@ethersproject/abstract-provider'
import { BlockTag } from '@ethersproject/abstract-provider'
require('dotenv').config()
import * as fs from 'fs'
import * as path from 'path' // Import the 'path' module

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
  ORBIT_RPC_URL: string
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
const l3Provider = new providers.JsonRpcProvider(process.env.ORBIT_RPC_URL)

const main = async (l3Chain: L3Network) => {
  // Checking if required environment variables are present
  if (
    !process.env.PARENT_RPC_URL ||
    !process.env.ORBIT_RPC_URL ||
    !process.env.FROM_BLOCK ||
    !process.env.TO_BLOCK
  ) {
    console.log(
      'Some variables are missing in the .env file. Check .env.example to find the required variables.'
    )
    return
  }

  // Adding your Obit chain as a custom chain to the Arbitrum SDK
  try {
    addCustomNetwork({ customL2Network: l3Chain })
  } catch (error: any) {
    console.error(`Failed to register Xai: ${error.message}`)
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
    const toBlock = parseInt(process.env.TO_BLOCK!)
    const fromBlock = parseInt(process.env.FROM_BLOCK!)

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

    for (let inboxDeliveredLog of inboxDeliveredLogs) {
      if (inboxDeliveredLog.data.length === 706) continue // depositETH bypass
      const { transactionHash: l2TxHash } = inboxDeliveredLog

      const l2TxReceipt = await l2Provider.getTransactionReceipt(
        '0x1cd430cbcb2d7fcf7308ac395af0f71e585401bbcd7fe5f26b7439d7426f72ae'
      )

      const arbL2TxReceipt = new L1TransactionReceipt(l2TxReceipt)

      const messages = await arbL2TxReceipt.getL1ToL2Messages(l3Provider)

      if (messages.length == 0) {
        console.log(`No retryable is found!`)
        break
      } else {
        console.log(
          `${messages.length} retryable${
            messages.length === 1 ? '' : 's'
          } found, checking their status. Arbtxhash: ${process.env
            .ARBISCAN!}${l2TxHash}`
        )
        console.log('************************************************')
      }

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
            `Ticket is succesfully redeemed:\norbitTxHash: ${l3Chain.explorerUrl}/tx/${retryableTicketId}`
          )
        }
      }
    }
  }

  await checkRetryablesOneOff()
}

// Calling main with networkConfig as a parameter
main(networkConfig)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
