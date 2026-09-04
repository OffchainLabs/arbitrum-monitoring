import { providers, Wallet } from 'ethers'
import {
  ParentTransactionReceipt,
  ParentToChildMessageStatus,
} from '@arbitrum/sdk'
import { getConfig, DEFAULT_CONFIG_PATH, ChildNetwork } from 'utils'
import dotenv from 'dotenv'
import { getLiveTicketTimeout } from './reportGenerator'

dotenv.config()

export const NOTION_EXECUTED_STATUS = 'Executed'
export const REDEEMABLE_STATUS =
  ParentToChildMessageStatus[
    ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD
  ]

type LocateOptions = {
  configPath?: string
  retryableCreationId?: string
  chainId?: number
}

const locateMessage = async (
  parentTxHash: string,
  {
    configPath = DEFAULT_CONFIG_PATH,
    retryableCreationId,
    chainId,
  }: LocateOptions
) => {
  const config = getConfig({ configPath })

  const pk = process.env.RETRYABLE_MONITORING_PRIVATE_KEY
  if (!pk) {
    throw new Error(
      'RETRYABLE_MONITORING_PRIVATE_KEY env var is required for redeemRetryable'
    )
  }

  // the caller usually knows which chain the ticket belongs to; probing every
  // configured chain is only a fallback
  const candidates: ChildNetwork[] = chainId
    ? config.childChains.filter((c: ChildNetwork) => c.chainId === chainId)
    : config.childChains

  const errors: unknown[] = []

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
      const wallet = new Wallet(pk, childChainProvider)

      const parentReceipt = new ParentTransactionReceipt(receipt)
      // the SDK filters these by the child chain's inbox, so a ticket never
      // matches a sibling chain that shares the same parent
      const messages = await parentReceipt.getParentToChildMessages(wallet)
      if (!messages || messages.length === 0) continue

      // a parent tx can create several tickets; pick the requested one so we
      // never touch a sibling ticket, falling back to the first when the
      // caller has no specific ticket in mind
      const message = retryableCreationId
        ? messages.find(
            m =>
              m.retryableCreationId.toLowerCase() ===
              retryableCreationId.toLowerCase()
          )
        : messages[0]
      if (!message) continue

      return { message, childChain, childChainProvider, errors }
    } catch (err) {
      console.error(
        `Error while processing parentTx ${parentTxHash} on chain ${childChain.chainId}:`,
        err
      )
      errors.push(err)
    }
  }

  return {
    message: null,
    childChain: null,
    childChainProvider: null,
    errors,
  }
}

/**
 * Reads the ticket's current status from the chain, so callers can reflect
 * reality regardless of who redeemed it. Returns null when the ticket cannot
 * be located on any configured chain.
 */
export const getLiveRetryableStatus = async (
  parentTxHash: string,
  options: LocateOptions = {}
): Promise<string | null> => {
  const { message, childChainProvider } = await locateMessage(
    parentTxHash,
    options
  )
  if (!message || !childChainProvider) return null

  const status = await message.status()

  if (status === ParentToChildMessageStatus.REDEEMED) {
    return NOTION_EXECUTED_STATUS
  }

  // a submit-retryable tx can be marked reverted even though the ticket was
  // created, which makes the SDK report live tickets as CREATION_FAILED
  if (status === ParentToChildMessageStatus.CREATION_FAILED) {
    const onChainTimeout = await getLiveTicketTimeout(
      message.retryableCreationId,
      childChainProvider
    )
    if (onChainTimeout !== undefined) return REDEEMABLE_STATUS
  }

  return ParentToChildMessageStatus[status]
}

export const redeemRetryable = async (
  parentTxHash: string,
  options: LocateOptions = {}
): Promise<string> => {
  const { message, childChain, errors } = await locateMessage(
    parentTxHash,
    options
  )

  if (message && childChain) {
    const already = await message.getSuccessfulRedeem().catch(() => null)
    if (already && already.status === ParentToChildMessageStatus.REDEEMED) {
      const existingHash =
        (already as any)?.childTxReceipt?.transactionHash ??
        (already as any)?.txHash
      if (existingHash) return existingHash
    }

    try {
      const tx = await message.redeem()
      console.log(
        `Sent redeem tx on childChain ${childChain.chainId}: ${tx.hash}`
      )
      const redeemReceipt = await tx.waitForRedeem()
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
      errors.push(redeemErr)
    }
  }

  const lastError = errors[errors.length - 1]
  const suffix =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : ''
  throw new Error(
    `Parent tx ${parentTxHash} not found/redeemable on any configured chain.${suffix}`
  )
}
