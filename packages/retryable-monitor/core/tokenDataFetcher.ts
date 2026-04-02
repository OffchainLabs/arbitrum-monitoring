import { FetchedEvent } from '@arbitrum/sdk/dist/lib/utils/eventFetcher'
import { TypedEvent } from '@arbitrum/sdk/dist/lib/abi/common'
import { providers } from 'ethers'
import {
  ParentTransactionReceipt,
  ParentToChildMessageReader,
} from '@arbitrum/sdk'
import { ERC20__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory'
import { L1ERC20Gateway__factory } from '@arbitrum/sdk/dist/lib/abi/factories/L1ERC20Gateway__factory'
import { L1CustomGateway__factory } from '@arbitrum/sdk/dist/lib/abi/factories/L1CustomGateway__factory'
import { L1WethGateway__factory } from '@arbitrum/sdk/dist/lib/abi/factories/L1WethGateway__factory'
import type { LogDescription } from '@ethersproject/abi'
import { TokenDepositData } from './types'

/**
 *  We build a list of gateway interfaces so we can parse logs
 *  coming from different gateway types (ERC20, Custom, WETH)
 *  This lets us decode events reliably without hardcoding indexes
 */
const gatewayIfaces = [
  L1ERC20Gateway__factory.createInterface(),
  L1CustomGateway__factory.createInterface(),
  L1WethGateway__factory.createInterface(),
]

/**
 * Try to decode a DepositInitiated log with one of the known gateway ABIs
 */
function parseDepositInitiatedLog(log: any): LogDescription | undefined {
  for (const iface of gatewayIfaces) {
    try {
      const parsed = iface.parseLog(log)
      if (parsed?.name === 'DepositInitiated') return parsed
    } catch {}
  }
  return undefined
}

/**
 * Given a retryable ticket, find its corresponding deposit on L1
 * by matching its sequence number to a DepositInitiated event
 * Then extract token + amount, and add token details
 */
export const getTokenDepositData = async ({
  childChainTx,
  retryableMessage,
  arbParentTxReceipt,
  depositsInitiatedLogs,
  parentChainProvider,
}: {
  childChainTx: providers.TransactionResponse
  retryableMessage: ParentToChildMessageReader
  arbParentTxReceipt: ParentTransactionReceipt
  depositsInitiatedLogs: FetchedEvent<TypedEvent<any, any>>[]
  parentChainProvider: providers.Provider
}): Promise<TokenDepositData | undefined> => {
  let parentChainErc20Address: string | undefined
  let tokenAmount: string | undefined
  let tokenDepositData: TokenDepositData | undefined

  // Use the message/sequence number as the key to match with the L1 log
  const seqNumHex = retryableMessage.messageNumber.toHexString().toLowerCase()

  // Find the DepositInitiated event that has the same sequence number
  const matched = depositsInitiatedLogs.find(
    (l: any) => (l.topics?.[3] ?? '').toLowerCase() === seqNumHex
  )

  if (matched) {
    try {
      // Decode the event using the correct ABI (ERC20, Custom, or WETH)
      const parsed = parseDepositInitiatedLog(matched)
      if (parsed) {
        const args: any = parsed.args
        parentChainErc20Address = (args?.l1Token ?? args?.token)?.toString()
        const amt = args?.amount ?? args?.value
        tokenAmount = amt ? amt.toString() : undefined
      }
    } catch (e) {
      console.log('failed to decode DepositInitiated', e)
    }
  }

  // If we successfully found a token deposit, fetch metadata
  if (parentChainErc20Address) {
    try {
      const erc20 = ERC20__factory.connect(
        parentChainErc20Address,
        parentChainProvider
      )
      const [symbol, decimals] = await Promise.all([
        erc20.symbol(),
        erc20.decimals(),
      ])
      tokenDepositData = {
        l2TicketId: retryableMessage.retryableCreationId,
        tokenAmount,
        sender: arbParentTxReceipt.from,
        l1Token: {
          symbol,
          decimals,
          id: parentChainErc20Address,
        },
      }
    } catch (e) {
      console.log('failed to fetch token data', e)
    }
  }

  return tokenDepositData
}
