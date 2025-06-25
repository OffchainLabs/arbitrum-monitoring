import { BigNumber, ethers, providers } from 'ethers'
import { getExplorerUrlPrefixes } from '../../utils'
import { OnFailedRetryableFoundParams } from '../core/types'
import { reportFailedRetryables } from './reportFailedRetryables'
import { syncRetryableToNotion } from './notion/syncRetryableToNotion'
import {
  formatL2Callvalue,
  getGasInfo,
  getTokenPrice,
} from './slack/slackMessageFormattingUtils'

export const handleFailedRetryablesFound = async (
  ticket: OnFailedRetryableFoundParams,
  writeToNotion: boolean
) => {
  // report the Retryable in Slack
  await reportFailedRetryables(ticket)

  // sync the Retryable to Notion
  if (writeToNotion) {
    const {
      tokenDepositData,
      childChainRetryableReport,
      childChain,
      parentChainRetryableReport,
    } = ticket

    const childChainProvider = new providers.JsonRpcProvider(
      String(childChain.orbitRpcUrl)
    )

    const parentChainProvider = new providers.JsonRpcProvider(
      String(childChain.parentRpcUrl)
    )

    const formattedCallValueFull = await formatL2Callvalue(
      childChainRetryableReport,
      childChain,
      parentChainProvider
    )

    const l2CallValueFormatted = formattedCallValueFull
      .replace('\n\t *Child chain callvalue:* ', '')
      .trim()

    let formattedTokenString: string | undefined = undefined
    if (tokenDepositData?.tokenAmount && tokenDepositData?.l1Token) {
      const amount = BigNumber.from(tokenDepositData.tokenAmount)
      const decimals = tokenDepositData.l1Token.decimals
      const symbol = tokenDepositData.l1Token.symbol
      const address = tokenDepositData.l1Token.id

      const humanAmount = Number(amount) / 10 ** decimals
      const price = (await getTokenPrice(address)) ?? 1
      const usdValue = humanAmount * price

      formattedTokenString = `${humanAmount.toFixed(
        6
      )} ${symbol} ($${usdValue.toFixed(2)}) (${address})`
    }
    const { l2GasPrice, l2GasPriceAtCreation } = await getGasInfo(
      childChainRetryableReport.createdAtBlockNumber,
      childChainRetryableReport.id,
      childChainProvider
    )

    const gasPriceProvided = `${ethers.utils.formatUnits(
      childChainRetryableReport.gasFeeCap,
      'gwei'
    )} gwei`
    const gasPriceAtCreation = l2GasPriceAtCreation
      ? `${ethers.utils.formatUnits(l2GasPriceAtCreation, 'gwei')} gwei`
      : undefined
    const gasPriceNow = `${ethers.utils.formatUnits(l2GasPrice, 'gwei')} gwei`

    const { PARENT_CHAIN_TX_PREFIX, CHILD_CHAIN_TX_PREFIX } =
      getExplorerUrlPrefixes(childChain)

    await syncRetryableToNotion({
      ChildTx: `${CHILD_CHAIN_TX_PREFIX}${childChainRetryableReport.id}`,
      ParentTx: `${PARENT_CHAIN_TX_PREFIX}${parentChainRetryableReport.transactionHash}`,
      createdAt: Number(childChainRetryableReport.createdAtTimestamp) * 1000,
      timeout: Number(childChainRetryableReport.timeoutTimestamp) * 1000,
      status: childChainRetryableReport.status,
      priority: 'Unset',
      chainId: childChain.chainId,
      chain: childChain.name,
      metadata: {
        tokensDeposited: formattedTokenString,
        gasPriceProvided,
        gasPriceAtCreation,
        gasPriceNow,
        l2CallValue: l2CallValueFormatted,
        decision: 'Triage'
      },
    })
  }
}
