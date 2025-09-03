import { providers, Wallet } from 'ethers'
import {
  ParentTransactionReceipt,
  ParentToChildMessageStatus,
} from '@arbitrum/sdk'
import { getConfig, DEFAULT_CONFIG_PATH } from '../../utils'
import dotenv from 'dotenv'

dotenv.config()

export const redeemRetryable = async (
  parentTxHash: string
): Promise<string> => {
  const config = getConfig({ configPath: DEFAULT_CONFIG_PATH })

  const pk = process.env.RETRYABLE_MONITORING_PRIVATE_KEY
  if (!pk) {
    throw new Error(
      'RETRYABLE_MONITORING_PRIVATE_KEY env var is required for redeemRetryable'
    )
  }

  let lastError: unknown

  for (const childChain of config.childChains) {
    try {
      // 1) Check parent chain for the tx
      const parentChainProvider = new providers.JsonRpcProvider(
        childChain.parentRpcUrl
      )
      const receipt = await parentChainProvider.getTransactionReceipt(
        parentTxHash
      )
      if (!receipt) continue

      // 2) We found the parent receipt -> attempt on its configured child
      const childChainProvider = new providers.JsonRpcProvider(
        childChain.orbitRpcUrl
      )
      const wallet = new Wallet(pk, childChainProvider)

      const parentReceipt = new ParentTransactionReceipt(receipt)
      const messages = await parentReceipt.getParentToChildMessages(wallet)
      if (!messages || messages.length === 0) continue // no L1->L2 messages associated; try next chain

      // If multiple, redeem the first (adjust selection logic if needed)
      const message = messages[0]

      // 3) If already redeemed, return its tx hash instead of throwing
      const already = await message.getSuccessfulRedeem().catch(() => null)
      if (already && already.status === ParentToChildMessageStatus.REDEEMED) {
        const existingHash =
          (already as any)?.childTxReceipt?.transactionHash ??
          (already as any)?.txHash
        if (existingHash) return existingHash
      }

      // 4) Redeem with error logging
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
        lastError = redeemErr
        continue
      }
    } catch (err) {
      console.error(
        `Error while processing parentTx ${parentTxHash} on chain ${childChain.chainId}:`,
        err
      )
      lastError = err
      continue
    }
  }

  const suffix =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : ''
  throw new Error(
    `Parent tx ${parentTxHash} not found/redeemable on any configured chain.${suffix}`
  )
}
