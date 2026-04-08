import { FetchedEvent } from '@arbitrum/sdk/dist/lib/utils/eventFetcher'
import { TypedEvent } from '@arbitrum/sdk/dist/lib/abi/common'
import { providers, utils } from 'ethers'
import {
  ParentTransactionReceipt,
  ParentToChildMessageReader,
} from '@arbitrum/sdk'
import { ERC20__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory'
import { TokenDepositData } from './types'

const ERC20_TRANSFER_TOPIC = utils.id('Transfer(address,address,uint256)')

const topicToAddress = (topic: string) => `0x${topic.slice(26).toLowerCase()}`

export const getTokenDepositData = async ({
  childChainTx,
  retryableMessage,
  parentTxReceipt,
  arbParentTxReceipt,
  depositsInitiatedLogs,
  gatewayAddresses,
  parentChainProvider,
}: {
  childChainTx: providers.TransactionResponse
  retryableMessage: ParentToChildMessageReader
  parentTxReceipt: providers.TransactionReceipt
  arbParentTxReceipt: ParentTransactionReceipt
  depositsInitiatedLogs: FetchedEvent<TypedEvent<any, any>>[]
  gatewayAddresses: Array<string | undefined | null>
  parentChainProvider: providers.Provider
}): Promise<TokenDepositData | undefined> => {
  let parentChainErc20Address: string | undefined,
    tokenAmount: string | undefined,
    tokenDepositData: TokenDepositData | undefined
  const sender = arbParentTxReceipt.from.toLowerCase()
  const gatewaySet = new Set(
    gatewayAddresses
      .filter((addr): addr is string => typeof addr === 'string' && addr.length > 0)
      .map(addr => addr.toLowerCase())
  )

  // Some retryable payloads include a request id that can map to DepositInitiated topic[3]
  let requestId: string | undefined
  try {
    const retryableMessageData = childChainTx.data
    const retryableBody = retryableMessageData.split('0xc9f95d32')[1]
    if (retryableBody) {
      requestId = '0x' + retryableBody.slice(0, 64)
    }
  } catch (e) {
    console.log(e)
  }

  const depositEventsForParentTx = depositsInitiatedLogs.filter(
    log => log.transactionHash === arbParentTxReceipt.transactionHash
  )
  const requestIdMatchedDepositEvent = requestId
    ? depositEventsForParentTx.find(log => log.topics[3] === requestId)
    : undefined
  // Prefer exact request id correlation when available; otherwise fall back to any deposit event in this tx.
  const selectedDepositEvent =
    requestIdMatchedDepositEvent ?? depositEventsForParentTx[0]

  // Always parse transfer candidates from this parent tx
  const transferLogs = parentTxReceipt.logs.filter(
    log => log.topics?.[0] === ERC20_TRANSFER_TOPIC && log.topics.length >= 3
  )
  const transferCandidates = transferLogs.map(log => ({
    tokenAddress: log.address,
    from: topicToAddress(log.topics[1]),
    to: topicToAddress(log.topics[2]),
    amount: utils.defaultAbiCoder.decode(['uint256'], log.data)[0].toString(),
  }))

  // If we have a deposit event, look for the corresponding transfer to confirm it.
  const correlatedTransfer = selectedDepositEvent
    ? transferCandidates.find(transfer => {
        const depositToken = String(selectedDepositEvent.event[0]).toLowerCase()
        const depositAmount = selectedDepositEvent.event[4]?.toString()
        return (
          transfer.tokenAddress.toLowerCase() === depositToken &&
          transfer.amount === depositAmount &&
          transfer.from === sender &&
          gatewaySet.has(transfer.to)
        )
      })
    : undefined

  const preferredTransfer = transferCandidates.find(
    transfer => transfer.from === sender && gatewaySet.has(transfer.to)
  )
  const fallbackTransfer = transferCandidates.find(
    transfer => transfer.from === sender
  )
  // Priority: exact deposit-match transfer > sender->gateway transfer > any sender transfer
  const selectedTransfer = correlatedTransfer ?? preferredTransfer ?? fallbackTransfer

  // DepositInitiated remains the primary source for token/amount when available
  if (selectedDepositEvent?.event?.[0]) {
    parentChainErc20Address = selectedDepositEvent.event[0]
  }
  if (selectedDepositEvent?.event?.[4] != null) {
    tokenAmount = selectedDepositEvent.event[4].toString()
  }

  if (!parentChainErc20Address && selectedTransfer) {
    parentChainErc20Address = selectedTransfer.tokenAddress
  }
  if (!tokenAmount && selectedTransfer) {
    tokenAmount = selectedTransfer.amount
  }

  // Fetch token metadata only after we've resolved a token address.
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
