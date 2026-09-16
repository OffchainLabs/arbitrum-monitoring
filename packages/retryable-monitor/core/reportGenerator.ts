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
import { withRetry, processBlockRangeInChunks } from 'utils'
import { ChildChainTicketReport, ParentChainTicketReport } from './types'

// selector of ArbRetryableTx's NoTicketWithID() custom error
const NO_TICKET_WITH_ID_SELECTOR = '0x80698456'

// same ceiling the checker scans with, so an RPC that accepts one accepts both
const REDEEM_SCAN_CHUNK_SIZE = 2000

// keccak256 of ArbRetryableTx's TicketCreated(bytes32) event signature
export const TICKET_CREATED_TOPIC =
  '0x7c793cced5743dc5f531bbe2bfb5a9fa3f40adef29231e6ab165c08a29e3dd89'

// a submit-retryable tx emits TicketCreated even when its receipt is marked
// as reverted (e.g. when the requested auto-redeem could not be paid for), so
// the event is what proves a ticket was actually created
export const hasTicketCreatedEvent = (receipt: TransactionReceipt): boolean =>
  (receipt.logs ?? []).some(
    log =>
      log.address.toLowerCase() === ARB_RETRYABLE_TX_ADDRESS.toLowerCase() &&
      log.topics[0] === TICKET_CREATED_TOPIC
  )

const isNoTicketWithIdError = (error: unknown): boolean => {
  let current = error as any
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (
      current.errorName === 'NoTicketWithID' ||
      (typeof current.message === 'string' &&
        current.message.includes('NoTicketWithID')) ||
      (typeof current.data === 'string' &&
        current.data.startsWith(NO_TICKET_WITH_ID_SELECTOR))
    ) {
      return true
    }
    current = current.error ?? current.cause
  }
  return false
}

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
    return await withRetry(
      () =>
        ArbRetryableTx__factory.connect(
          ARB_RETRYABLE_TX_ADDRESS,
          childChainProvider
        ).callStatic.getTimeout(ticketId),
      { label: 'ArbRetryableTx.getTimeout' }
    )
  } catch (error) {
    // only the NoTicketWithID() revert proves the ticket doesn't exist;
    // anything else (e.g. RPC failure) must not be mistaken for that
    if (isNoTicketWithIdError(error)) return undefined
    throw error
  }
}

/**
 * Hash of the tx that successfully redeemed the ticket, or undefined.
 *
 * Needed because the SDK reports a ticket whose creation receipt is marked
 * reverted as CREATION_FAILED and returns before it looks for a redemption.
 */
export const findSuccessfulRedeem = async (
  ticketId: string,
  creationBlockNumber: number,
  childChainProvider: providers.Provider
): Promise<string | undefined> => {
  const arbRetryableTx = ArbRetryableTx__factory.connect(
    ARB_RETRYABLE_TX_ADDRESS,
    childChainProvider
  )
  const filter = arbRetryableTx.filters.RedeemScheduled(ticketId)
  const latestBlock = await childChainProvider.getBlockNumber()

  return processBlockRangeInChunks<string | undefined>(
    creationBlockNumber,
    latestBlock,
    REDEEM_SCAN_CHUNK_SIZE,
    async (fromBlock, toBlock) => {
      const logs = await withRetry(
        () => childChainProvider.getLogs({ ...filter, fromBlock, toBlock }),
        { label: 'ArbRetryableTx.RedeemScheduled' }
      )

      for (const log of logs) {
        const { retryTxHash } = arbRetryableTx.interface.parseLog(log).args
        const receipt = await childChainProvider.getTransactionReceipt(
          retryTxHash
        )
        if (receipt?.status === 1) return retryTxHash
      }

      return undefined
    },
    (prev, next) => prev ?? next,
    undefined,
    { stopWhen: found => found !== undefined }
  )
}

export const isPastTicketLifetime = (createdAtTimestamp: number): boolean =>
  Date.now() / 1000 >= createdAtTimestamp + SEVEN_DAYS_IN_SECONDS

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

  // a ticket that was created (TicketCreated emitted) but no longer exists
  // on-chain past its lifetime has expired — report it as EXPIRED so the
  // stale-ticket muting applies, instead of re-alerting it forever as
  // CREATION_FAILED
  if (
    status === ParentToChildMessageStatus.CREATION_FAILED &&
    hasTicketCreatedEvent(childChainTxReceipt) &&
    isPastTicketLifetime(Number(timestamp))
  ) {
    status = ParentToChildMessageStatus.EXPIRED
  }

  const childChainTicketReport = {
    id: retryableMessage.retryableCreationId,
    retryTxHash: (await retryableMessage.getAutoRedeemAttempt())
      ?.transactionHash,
    // in seconds, same unit as timeoutTimestamp
    createdAtTimestamp: String(timestamp),
    createdAtBlockNumber: childChainTxReceipt.blockNumber,
    // prefer the actual on-chain timeout (accounts for keepalive extensions)
    timeoutTimestamp:
      onChainTimeout !== undefined
        ? onChainTimeout.toString()
        : String(Number(timestamp) + SEVEN_DAYS_IN_SECONDS),
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
