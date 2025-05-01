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
import { SEVEN_DAYS_IN_SECONDS } from '@arbitrum/sdk/dist/lib/dataEntities/constants'
import { ChildChainTicketReport, ParentChainTicketReport } from './types'

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
    retryTo: retryableMessage.messageData.destAddress,
    retryData: retryableMessage.messageData.data,
    gasFeeCap: (childChainTx.maxFeePerGas ?? BigNumber.from(0)).toNumber(),
    gasLimit: childChainTx.gasLimit.toNumber(),
  }

  return childChainTicketReport
}
