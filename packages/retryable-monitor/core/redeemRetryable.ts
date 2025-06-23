import { providers, Wallet } from 'ethers'
import {
  ParentTransactionReceipt,
  ParentToChildMessageStatus,
} from '@arbitrum/sdk'
import { getConfig, DEFAULT_CONFIG_PATH } from '../../utils'
import dotenv from 'dotenv'

dotenv.config()

export const redeemRetryable = async (parentTxHash: string): Promise<string> => {
  const config = getConfig({ configPath: DEFAULT_CONFIG_PATH })

  for (const childChain of config.childChains) {
    try {
      const parentChainProvider = new providers.JsonRpcProvider(childChain.parentRpcUrl)
      const receipt = await parentChainProvider.getTransactionReceipt(parentTxHash)
      if (!receipt) continue // not found on this chain

      // If we found the receipt, this is our matching chain
      const childChainProvider = new providers.JsonRpcProvider(childChain.orbitRpcUrl)
      const wallet = new Wallet(process.env.PRIVATE_KEY!, childChainProvider)

      const parentReceipt = new ParentTransactionReceipt(receipt)
      const messages = await parentReceipt.getParentToChildMessages(wallet)
      const message = messages[0]

      const result = await message.getSuccessfulRedeem()
      if (result.status === ParentToChildMessageStatus.REDEEMED) {
        return result.childTxReceipt.transactionHash
      }

      const tx = await message.redeem()
      const redeemReceipt = await tx.waitForRedeem()
      return redeemReceipt.transactionHash
    } catch (err) {
      // Catch and move to next chain silently
      continue
    }
  }

  throw new Error(`❌ Parent tx ${parentTxHash} not found on any known parent chain.`)
}
