import { FetchedEvent } from '@arbitrum/sdk/dist/lib/utils/eventFetcher'
import { TypedEvent } from '@arbitrum/sdk/dist/lib/abi/common'
import { providers } from 'ethers'
import {
  ParentTransactionReceipt,
  ParentToChildMessageReader,
} from '@arbitrum/sdk'
import { ERC20__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory'
import { TokenDepositData } from './types'

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
  let parentChainErc20Address: string | undefined,
    tokenAmount: string | undefined,
    tokenDepositData: TokenDepositData | undefined

  try {
    const retryableMessageData = childChainTx.data
    const retryableBody = retryableMessageData.split('0xc9f95d32')[1]
    const requestId = '0x' + retryableBody.slice(0, 64)
    const depositsInitiatedEvent = depositsInitiatedLogs.find(
      log => log.topics[3] === requestId
    )
    parentChainErc20Address = depositsInitiatedEvent?.event[0]
    tokenAmount = depositsInitiatedEvent?.event[4]?.toString()
  } catch (e) {
    console.log(e)
  }

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
