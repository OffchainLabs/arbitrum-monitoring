import { providers } from 'ethers'
import { ChildNetwork, getExplorerUrlPrefixes } from '../../utils'
import { OnFailedRetryableFoundParams } from '../core/types'
import { reportFailedRetryables } from './reportFailedRetryables'
import { syncRetryableToNotion } from './notion/syncRetryableToNotion'

export const handleFailedRetryablesFound = async (
  ticket: OnFailedRetryableFoundParams,
  childChain: ChildNetwork,
  childChainProvider: providers.Provider,
  writeToNotion: boolean
) => {
  // report the Retryable in Slack
  await reportFailedRetryables(ticket)

  // sync the Retryable to Notion
  if (writeToNotion) {
    const { PARENT_CHAIN_TX_PREFIX, CHILD_CHAIN_TX_PREFIX } =
      getExplorerUrlPrefixes(childChain)

    await syncRetryableToNotion({
      ChildTx: `${CHILD_CHAIN_TX_PREFIX}${ticket.childChainRetryableReport.id}`,
      ParentTx: `${PARENT_CHAIN_TX_PREFIX}${ticket.parentChainRetryableReport.transactionHash}`,
      createdAt: +ticket.childChainRetryableReport.createdAtTimestamp,
      timeout: +ticket.childChainRetryableReport.timeoutTimestamp,
      status: 'Untriaged',
      priority: 'High',
      metadata: {
        tokensDeposited: ticket.tokenDepositData?.tokenAmount,
        gasPriceProvided: ticket.childChainRetryableReport.gasFeeCap.toString(),
        gasPriceNow: (await childChainProvider.getGasPrice()).toString(),
        l2CallValue: ticket.childChainRetryableReport.deposit,
      },
    })
  }
}
