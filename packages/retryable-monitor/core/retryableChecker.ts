/*
This file contains the logic for checking retryables in the given block range for the chain
*/

import { providers } from 'ethers'
import {
  ParentTransactionReceipt,
  ParentToChildMessageStatus,
} from '@arbitrum/sdk'
import { ChildNetwork } from '../../utils'
import {
  getMessageDeliveredEventData,
  getDepositInitiatedLogs,
} from './depositEventFetcher'
import {
  getParentChainRetryableReport,
  getChildChainRetryableReport,
} from './reportGenerator'
import { getExplorerUrlPrefixes } from '../../utils'
import { OnFailedRetryableFound, OnRedeemedRetryableFound } from './types'
import { getTokenDepositData } from './tokenDataFetcher'
import { SEVEN_DAYS_IN_SECONDS } from '@arbitrum/sdk/dist/lib/dataEntities/constants'

export const checkRetryables = async (
  parentChainProvider: providers.Provider,
  childChainProvider: providers.Provider,
  childChain: ChildNetwork,
  bridgeAddress: string,
  fromBlock: number,
  toBlock: number,
  enableAlerting: boolean,
  onFailedRetryableFound?: OnFailedRetryableFound,
  onRedeemedRetryableFound?: OnRedeemedRetryableFound
): Promise<boolean> => {
  let retryablesFound = false

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
    gatewayAddresses: {
      parentErc20Gateway: childChain.tokenBridge!.parentErc20Gateway,
      parentCustomGateway: childChain.tokenBridge!.parentCustomGateway,
      parentWethGateway: childChain.tokenBridge!.parentWethGateway,
    },
  })

  const uniqueTxHashes = new Set<string>()
  for (let messageDeliveredLog of messageDeliveredLogs) {
    const { transactionHash: parentTxHash } = messageDeliveredLog
    uniqueTxHashes.add(parentTxHash)
  }

  const { PARENT_CHAIN_TX_PREFIX, CHILD_CHAIN_TX_PREFIX } =
    getExplorerUrlPrefixes(childChain)

  // for each parent-chain-transaction found, extract the Retryables thus created by it
  for (const parentTxHash of uniqueTxHashes) {
    const parentTxReceipt = await parentChainProvider.getTransactionReceipt(
      parentTxHash
    )
    const arbParentTxReceipt = new ParentTransactionReceipt(parentTxReceipt)
    const retryables = await arbParentTxReceipt.getParentToChildMessages(
      childChainProvider
    )

    if (retryables.length > 0) {
      console.log(
        `${retryables.length} retryable${
          retryables.length === 1 ? '' : 's'
        } found for ${
          childChain.name
        } chain. Checking their status:\n\nParentChainTxHash: ${
          PARENT_CHAIN_TX_PREFIX + parentTxHash
        }`
      )
      console.log('----------------------------------------------------------')

      // for each retryable, extract the detail for it's status / redemption
      for (let msgIndex = 0; msgIndex < retryables.length; msgIndex++) {
        const retryableMessage = retryables[msgIndex]
        const retryableTicketId = retryableMessage.retryableCreationId
        let status = await retryableMessage.status()

        // if we find a successful Retryable, call `onRedeemedRetryableFound()`
        if (status === ParentToChildMessageStatus.REDEEMED) {
          if (enableAlerting && onRedeemedRetryableFound) {
            await onRedeemedRetryableFound({
              ChildTx: `${CHILD_CHAIN_TX_PREFIX}${retryableMessage.retryableCreationId}`,
              ParentTx: `${PARENT_CHAIN_TX_PREFIX}${parentTxHash}`,
              createdAt: Date.now(), // fallback; won't overwrite real one
              timeout: Date.now() + SEVEN_DAYS_IN_SECONDS * 1000,
              status: 'Resolved',
              priority: 'Unset',
              metadata: {
                tokensDeposited: undefined,
                gasPriceProvided: '-',
                gasPriceAtCreation: undefined,
                gasPriceNow: '-',
                l2CallValue: '-',
              },
            })
          }
        }

        // if a Retryable is not in a successful state, extract it's details and call `onFailedRetryableFound()`
        if (status !== ParentToChildMessageStatus.REDEEMED) {
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
            console.log(
              `${msgIndex + 1}. ${
                ParentToChildMessageStatus[status]
              }:\nChildChainTxHash: ${
                CHILD_CHAIN_TX_PREFIX + retryableTicketId
              } (Receipt not found yet)`
            )
            continue
          }

          const parentChainRetryableReport = getParentChainRetryableReport(
            arbParentTxReceipt,
            retryableMessage
          )
          const childChainRetryableReport = await getChildChainRetryableReport({
            retryableMessage,
            childChainTx,
            childChainTxReceipt,
            childChainProvider,
          })
          const tokenDepositData = await getTokenDepositData({
            childChainTx,
            retryableMessage,
            arbParentTxReceipt,
            depositsInitiatedLogs,
            parentChainProvider,
          })

          // Call the provided callback if it exists
          if (enableAlerting && onFailedRetryableFound) {
            await onFailedRetryableFound({
              parentChainRetryableReport,
              childChainRetryableReport,
              tokenDepositData,
              childChain,
            })
          }
        }

        // format the result message
        console.log(
          `${msgIndex + 1}. ${
            ParentToChildMessageStatus[status]
          }:\nChildChainTxHash: ${CHILD_CHAIN_TX_PREFIX + retryableTicketId}`
        )
        console.log(
          '----------------------------------------------------------'
        )
      }
      retryablesFound = true // Set to true if retryables are found
    }
  }

  return retryablesFound
}
