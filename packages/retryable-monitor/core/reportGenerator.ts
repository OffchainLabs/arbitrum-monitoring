/*
  Logic for generating the intermediate details for the Retryables
*/

import {
  ParentToChildMessageStatus,
  ParentTransactionReceipt,
  ParentToChildMessageReader,
} from '@arbitrum/sdk'
import { BigNumber, providers } from 'ethers'
import { TransactionReceipt } from '@ethersproject/abstract-provider'
import {
  ARB_RETRYABLE_TX_ADDRESS,
  SEVEN_DAYS_IN_SECONDS,
} from '@arbitrum/sdk/dist/lib/dataEntities/constants'
import { ArbRetryableTx__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ArbRetryableTx__factory'
import { ChildChainTicketReport, ParentChainTicketReport } from './types'

/**
 * Returns the ticket's on-chain timeout if it is still live, or undefined if
 * it doesn't exist (never created, redeemed, cancelled or expired).
 *
 * Needed because a submit-retryable tx can be marked as reverted even though
 * the ticket was created (e.g. when the requested auto-redeem could not be
 * paid for), which makes the SDK report live, redeemable tickets as
 * CREATION_FAILED.
 */
export const getLiveTicketTimeout = async (
  ticketId: string,
  childChainProvider: providers.Provider
): Promise<BigNumber | undefined> => {
  try {
    return await ArbRetryableTx__factory.connect(
      ARB_RETRYABLE_TX_ADDRESS,
      childChainProvider
    ).callStatic.getTimeout(ticketId)
  } catch {
    // reverts with NoTicketWithID() when the ticket doesn't exist
    return undefined
  }
}

export const getParentChainRetryableReport = (
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

export const getChildChainRetryableReport = async ({
  childChainTx,
  childChainTxReceipt,
  retryableMessage,
  childChainProvider,
}: {
  childChainTx: providers.TransactionResponse
  childChainTxReceipt: TransactionReceipt
  retryableMessage: ParentToChildMessageReader
  childChainProvider: providers.Provider
}): Promise<ChildChainTicketReport> => {
  let status = await retryableMessage.status()
  let onChainTimeout: BigNumber | undefined = undefined

  if (status === ParentToChildMessageStatus.CREATION_FAILED) {
    onChainTimeout = await getLiveTicketTimeout(
      retryableMessage.retryableCreationId,
      childChainProvider
    )
    if (onChainTimeout !== undefined) {
      status = ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD
    }
  }

  const timestamp = (
    await childChainProvider.getBlock(childChainTxReceipt.blockNumber)
  ).timestamp

  const childChainTicketReport = {
    id: retryableMessage.retryableCreationId,
    retryTxHash: (await retryableMessage.getAutoRedeemAttempt())
      ?.transactionHash,
    // in seconds, same unit as timeoutTimestamp
    createdAtTimestamp: String(timestamp),
    createdAtBlockNumber: childChainTxReceipt.blockNumber,
    // prefer the actual on-chain timeout (accounts for keepalive extensions)
    timeoutTimestamp: String(
      onChainTimeout !== undefined
        ? onChainTimeout.toNumber()
        : Number(timestamp) + SEVEN_DAYS_IN_SECONDS
    ),
    deposit: String(retryableMessage.messageData.l2CallValue), // eth amount
    status: ParentToChildMessageStatus[status],
    retryTo: retryableMessage.messageData.destAddress,
    retryData: retryableMessage.messageData.data,
    gasFeeCap: (childChainTx.maxFeePerGas ?? BigNumber.from(0)).toNumber(),
    gasLimit: childChainTx.gasLimit.toNumber(),
    feeRefundAddress: retryableMessage.messageData.excessFeeRefundAddress,
    beneficiary: retryableMessage.messageData.callValueRefundAddress,
    l2CallValue: retryableMessage.messageData.l2CallValue.toString(),
  }

  return childChainTicketReport
}
