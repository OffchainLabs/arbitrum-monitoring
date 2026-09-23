import { providers, Wallet } from 'ethers'
import {
  ParentTransactionReceipt,
  ParentToChildMessageReader,
  ParentToChildMessageStatus,
  ChildTransactionReceipt,
} from '@arbitrum/sdk'
import { ARB_RETRYABLE_TX_ADDRESS } from '@arbitrum/sdk/dist/lib/dataEntities/constants'
import { ArbRetryableTx__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ArbRetryableTx__factory'
import { getConfig, DEFAULT_CONFIG_PATH, ChildNetwork } from 'utils'
import dotenv from 'dotenv'
import {
  getLiveTicketTimeout,
  hasTicketCreatedEvent,
  findSuccessfulRedeem,
  isPastTicketLifetime,
} from './reportGenerator'

dotenv.config()

export const REDEEMABLE_STATUS =
  ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD

type LocateOptions = {
  configPath?: string
  retryableCreationId?: string
  chainId?: number
}

export type LocatedRetryable = {
  message: ParentToChildMessageReader
  childChain: ChildNetwork
  childChainProvider: providers.JsonRpcProvider
}

export const locateRetryable = async (
  parentTxHash: string,
  {
    configPath = DEFAULT_CONFIG_PATH,
    retryableCreationId,
    chainId,
  }: LocateOptions
): Promise<LocatedRetryable | null> => {
  const config = getConfig({ configPath })

  const candidates: ChildNetwork[] = chainId
    ? config.childChains.filter((c: ChildNetwork) => c.chainId === chainId)
    : config.childChains

  for (const childChain of candidates) {
    try {
      const parentChainProvider = new providers.JsonRpcProvider(
        childChain.parentRpcUrl
      )
      const receipt = await parentChainProvider.getTransactionReceipt(
        parentTxHash
      )
      if (!receipt) continue

      const childChainProvider = new providers.JsonRpcProvider(
        childChain.orbitRpcUrl
      )
      const parentReceipt = new ParentTransactionReceipt(receipt)
      // the SDK filters these by the child chain's inbox, so a ticket never
      // matches a sibling chain sharing the same parent
      const messages = await parentReceipt.getParentToChildMessages(
        childChainProvider
      )
      if (!messages || messages.length === 0) continue

      // a parent tx can create several tickets; never touch a sibling
      const message = retryableCreationId
        ? messages.find(
            m =>
              m.retryableCreationId.toLowerCase() ===
              retryableCreationId.toLowerCase()
          )
        : messages[0]
      if (!message) continue

      return { message, childChain, childChainProvider }
    } catch (err) {
      console.error(
        `Error while processing parentTx ${parentTxHash} on chain ${childChain.chainId}:`,
        err
      )
    }
  }

  return null
}

export const getLiveRetryableStatus = async ({
  message,
  childChainProvider,
}: LocatedRetryable): Promise<ParentToChildMessageStatus> => {
  const status = await message.status()

  // a submit-retryable tx can be marked reverted even though the ticket was
  // created, and the SDK calls those CREATION_FAILED without looking further
  if (status === ParentToChildMessageStatus.CREATION_FAILED) {
    const creationReceipt = await message.getRetryableCreationReceipt()
    if (!creationReceipt || !hasTicketCreatedEvent(creationReceipt)) {
      return status
    }

    const onChainTimeout = await getLiveTicketTimeout(
      message.retryableCreationId,
      childChainProvider
    )
    if (onChainTimeout !== undefined) return REDEEMABLE_STATUS

    // created but gone: redeemed, cancelled or expired
    const redeemTxHash = await findSuccessfulRedeem(
      message.retryableCreationId,
      creationReceipt.blockNumber,
      childChainProvider
    )
    if (redeemTxHash) return ParentToChildMessageStatus.REDEEMED

    // resolve expiry the same way the checker does, or the two would write
    // conflicting statuses for the same ticket
    const { timestamp } = await childChainProvider.getBlock(
      creationReceipt.blockNumber
    )
    if (isPastTicketLifetime(timestamp)) {
      return ParentToChildMessageStatus.EXPIRED
    }
  }

  return status
}

export const redeemRetryable = async ({
  message,
  childChain,
  childChainProvider,
}: LocatedRetryable): Promise<string> => {
  const pk = process.env.RETRYABLE_MONITORING_PRIVATE_KEY
  if (!pk) {
    throw new Error(
      'RETRYABLE_MONITORING_PRIVATE_KEY env var is required for redeemRetryable'
    )
  }

  const wallet = new Wallet(pk, childChainProvider)
  try {
    // the SDK's redeem() rejects tickets it reports as CREATION_FAILED, so
    // NoTicketWithID stands in for its guard and we call the precompile
    const onChainTimeout = await getLiveTicketTimeout(
      message.retryableCreationId,
      childChainProvider
    )

    if (onChainTimeout === undefined) {
      throw new Error(
        `Ticket ${message.retryableCreationId} no longer exists on chain ${childChain.chainId}`
      )
    }

    const arbRetryableTx = ArbRetryableTx__factory.connect(
      ARB_RETRYABLE_TX_ADDRESS,
      wallet
    )
    const redeemTx = await arbRetryableTx.redeem(message.retryableCreationId)
    console.log(
      `Sent redeem tx on childChain ${childChain.chainId}: ${redeemTx.hash}`
    )

    const redeemReceipt = await ChildTransactionReceipt.toRedeemTransaction(
      ChildTransactionReceipt.monkeyPatchWait(redeemTx),
      childChainProvider
    ).waitForRedeem()

    // waitForRedeem does not inspect the receipt, and a reverted retry
    // leaves the ticket redeemable
    if (redeemReceipt?.status !== 1) {
      throw new Error(
        `Retry execution ${
          redeemReceipt?.transactionHash ?? '(no receipt)'
        } for ticket ${message.retryableCreationId} did not succeed`
      )
    }

    console.log(
      `Redeem successful on childChain ${childChain.chainId}: ${redeemReceipt.transactionHash}`
    )
    return redeemReceipt.transactionHash
  } catch (redeemErr) {
    console.error(
      `Redeem failed on childChain ${childChain.chainId}. ` +
        `Check tx hash if available: ${
          (redeemErr as any)?.transactionHash || 'N/A'
        }`,
      redeemErr
    )
    const suffix =
      redeemErr instanceof Error ? ` Last error: ${redeemErr.message}` : ''
    throw new Error(
      `Ticket ${message.retryableCreationId} is not redeemable on chain ${childChain.chainId}.${suffix}`
    )
  }
}
