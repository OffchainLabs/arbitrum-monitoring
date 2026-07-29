import * as fs from 'fs'
import * as path from 'path'
import { getExplorerUrlPrefixes } from 'utils'
import { OnFailedRetryableFoundParams } from '../core/types'
import { isZeroValueTicket } from './zeroValueTicketDigest'

// written to the working directory — the package root when run via the pnpm
// workspace scripts — so the CI workflow can upload it as a run artifact;
// every failed retryable found in the run lands here, including the
// zero-value ones that only appear in the Slack digest
export const RUN_REPORT_FILENAME = 'retryable-run-report.json'

export interface ReportedRetryableEntry {
  chainId: number
  chainName: string
  status: string
  isZeroValue: boolean
  // input for redeemRetryable() / manual redemption
  parentChainTxHash: string
  parentChainTxUrl: string
  childChainTicketId: string
  childChainTicketUrl: string
  sender: string
  destination: string
  l2CallValueWei: string
  tokenDeposit: {
    amount: string
    symbol: string
    decimals: number
    address: string
  } | null
  createdAt: string
  expiresAt: string
}

const reportedRetryables: ReportedRetryableEntry[] = []

const toIsoDate = (timestampInSeconds: string) => {
  const ms = Number(timestampInSeconds) * 1000
  return Number.isFinite(ms) ? new Date(ms).toISOString() : ''
}

export const recordReportedRetryable = (
  ticket: OnFailedRetryableFoundParams
) => {
  const {
    parentChainRetryableReport,
    childChainRetryableReport,
    tokenDepositData,
    childChain,
  } = ticket

  const { PARENT_CHAIN_TX_PREFIX, CHILD_CHAIN_TX_PREFIX } =
    getExplorerUrlPrefixes(childChain)

  reportedRetryables.push({
    chainId: childChain.chainId,
    chainName: childChain.name,
    status: childChainRetryableReport.status,
    isZeroValue: isZeroValueTicket(ticket),
    parentChainTxHash: parentChainRetryableReport.transactionHash,
    parentChainTxUrl:
      PARENT_CHAIN_TX_PREFIX + parentChainRetryableReport.transactionHash,
    childChainTicketId: childChainRetryableReport.id,
    childChainTicketUrl: CHILD_CHAIN_TX_PREFIX + childChainRetryableReport.id,
    sender: parentChainRetryableReport.sender,
    destination: childChainRetryableReport.retryTo,
    l2CallValueWei: childChainRetryableReport.deposit,
    tokenDeposit:
      tokenDepositData?.tokenAmount && tokenDepositData.l1Token
        ? {
            amount: tokenDepositData.tokenAmount,
            symbol: tokenDepositData.l1Token.symbol,
            decimals: tokenDepositData.l1Token.decimals,
            address: tokenDepositData.l1Token.id,
          }
        : null,
    createdAt: toIsoDate(childChainRetryableReport.createdAtTimestamp),
    expiresAt: toIsoDate(childChainRetryableReport.timeoutTimestamp),
  })
}

export const writeRunReport = () => {
  const reportPath = path.join(process.cwd(), RUN_REPORT_FILENAME)

  const report = {
    generatedAt: new Date().toISOString(),
    totalFailedRetryables: reportedRetryables.length,
    zeroValueRetryables: reportedRetryables.filter(r => r.isZeroValue).length,
    retryables: reportedRetryables,
  }

  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(
      `Run report with ${reportedRetryables.length} failed retryable(s) written to ${reportPath}`
    )
  } catch (e) {
    console.error(`Could not write run report to ${reportPath}`, e)
  }
}
