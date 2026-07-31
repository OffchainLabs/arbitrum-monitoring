import { ChildNetwork } from 'utils'
import {
  ChildChainTicketReport,
  ParentChainTicketReport,
  TokenDepositData,
} from '../core/types'
import {
  addTicketToZeroValueDigest,
  isZeroValueTicket,
} from './zeroValueTicketDigest'
import { addTicketToFundedDigest } from './fundedTicketDigest'

export const reportFailedRetryables = async ({
  parentChainRetryableReport,
  childChainRetryableReport,
  tokenDepositData,
  childChain,
}: {
  parentChainRetryableReport: ParentChainTicketReport
  childChainRetryableReport: ChildChainTicketReport
  tokenDepositData?: TokenDepositData
  childChain: ChildNetwork
}) => {
  const t = childChainRetryableReport
  const now = Math.floor(new Date().getTime() / 1000) // now in s

  // don't report tickets which are not yet scheduled if they have been created in last 2h
  const reportingPeriodForNotScheduled = 2 * 60 * 60 // 2 hours in s
  if (
    t.status == 'NOT_YET_CREATED' &&
    now - +t.createdAtTimestamp < reportingPeriodForNotScheduled
  ) {
    return
  }

  // don't report tickets which expired more than 2 days ago
  const reportingPeriodForExpired = 2 * 24 * 60 * 60 // 2 days in s
  if (
    t.status == 'EXPIRED' &&
    now - +t.timeoutTimestamp > reportingPeriodForExpired
  ) {
    return
  }

  // a genuine creation failure (no ticket was ever created) is terminal and
  // only actionable while fresh — don't re-report ones older than 2 days
  const reportingPeriodForCreationFailed = 2 * 24 * 60 * 60 // 2 days in s
  if (
    t.status == 'CREATION_FAILED' &&
    now - +t.createdAtTimestamp > reportingPeriodForCreationFailed
  ) {
    return
  }

  // zero-value tickets go into a single per-chain digest posted at the end of
  // the chain's run instead of one Slack message per ticket
  if (
    isZeroValueTicket({
      childChainRetryableReport,
      tokenDepositData,
    })
  ) {
    addTicketToZeroValueDigest({
      parentChainRetryableReport,
      childChainRetryableReport,
      tokenDepositData,
      childChain,
    })
    return
  }

  // funded tickets are buffered too: small batches are posted as the usual
  // detailed per-ticket alerts once the chain's run completes, large bursts
  // are rolled into a single digest (see postFundedTicketAlerts)
  addTicketToFundedDigest({
    parentChainRetryableReport,
    childChainRetryableReport,
    tokenDepositData,
    childChain,
  })
}
