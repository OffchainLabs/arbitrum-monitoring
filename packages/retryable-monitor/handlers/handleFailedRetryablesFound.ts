import { BigNumber, ethers, providers } from 'ethers'
import { getExplorerUrlPrefixes } from 'utils'
import { OnFailedRetryableFoundParams } from '../core/types'
import { reportFailedRetryables } from './reportFailedRetryables'
import { recordReportedRetryable } from './runReport'
import { syncRetryableToNotion } from './notion/syncRetryableToNotion'
import { addToFetchedNotionRetryables } from './notion/fetchedNotionRetryablesUtils'
import {
  formatL2Callvalue,
  getGasInfo,
  getTokenPrice,
} from './slack/slackMessageFormattingUtils'

export const handleFailedRetryablesFound = async (
  ticket: OnFailedRetryableFoundParams,
  writeToNotion: boolean
) => {
  // every failed retryable found in the run goes into the JSON run report,
  // regardless of whether it is alerted via Slack or synced to Notion
  recordReportedRetryable(ticket)

  //old slack alert: only when not writing to Notion
  if (!writeToNotion) {
    await reportFailedRetryables(ticket)
  }

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

    const childTxUrl = `${CHILD_CHAIN_TX_PREFIX}${childChainRetryableReport.id}`

    const result = await syncRetryableToNotion({
      ChildTx: childTxUrl,
      ParentTx: parentChainRetryableReport.transactionHash,
      ParentTxUrl: `${PARENT_CHAIN_TX_PREFIX}${parentChainRetryableReport.transactionHash}`,
      createdAt: Number(childChainRetryableReport.createdAtTimestamp) * 1000,
      timeout: Number(childChainRetryableReport.timeoutTimestamp) * 1000,
      status: childChainRetryableReport.status,
      chainId: childChain.chainId,
      chain: childChain.name,
      decision: 'Triage',
      metadata: {
        tokensDeposited: formattedTokenString,
        gasPriceProvided,
        gasPriceAtCreation,
        gasPriceNow,
        l2CallValue: l2CallValueFormatted,
        feeRefundAddress: childChainRetryableReport.feeRefundAddress,
        beneficiary: childChainRetryableReport.beneficiary,
        retryTo: childChainRetryableReport.retryTo,
        retryData: childChainRetryableReport.retryData,
      },
    })

    // Keep the fetched (locally cached) set coherent so a redemption event later in the same
    // run routes through the update path instead of being filtered out.
    if (result) addToFetchedNotionRetryables(childTxUrl)
  }
}
