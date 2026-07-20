import { providers } from 'ethers'
import { ChildNetwork } from 'utils'
import {
  ChildChainTicketReport,
  ParentChainTicketReport,
  TokenDepositData,
} from '../core/types'
import { postSlackMessage } from './slack/postSlackMessage'
import { generateFailedRetryableSlackMessage } from './slack/slackMessageGenerator'
import {
  addTicketToZeroValueDigest,
  isZeroValueTicket,
} from './zeroValueTicketDigest'

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

  const childChainProvider = new providers.JsonRpcProvider(
    String(childChain.orbitRpcUrl)
  )

  const parentChainProvider = new providers.JsonRpcProvider(
    String(childChain.parentRpcUrl)
  )

  try {
    const reportStr = await generateFailedRetryableSlackMessage({
      parentChainRetryableReport,
      childChainRetryableReport,
      tokenDepositData,
      childChain,
      parentChainProvider,
      childChainProvider,
    })

    postSlackMessage({ message: reportStr })
  } catch (e) {
    console.log('Could not send slack message', e)
  }
}
