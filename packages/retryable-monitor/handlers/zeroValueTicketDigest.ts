import { BigNumber } from 'ethers'
import { ChildNetwork, getExplorerUrlPrefixes } from 'utils'
import { OnFailedRetryableFoundParams } from '../core/types'
import { postSlackMessage } from './slack/postSlackMessage'
import { timestampToDate } from './slack/slackMessageFormattingUtils'

// cap the per-ticket and per-sender lines in the digest; the full list always
// lands in the run's JSON report
const MAX_TICKETS_LISTED = 20
const MAX_SENDERS_LISTED = 5

const isZeroAmount = (amount?: string) => {
  if (!amount) return true
  try {
    return BigNumber.from(amount).isZero()
  } catch {
    // unparseable amounts must not silence a potentially real deposit
    return false
  }
}

const tokenDepositIsZero = (
  tokenDepositData: OnFailedRetryableFoundParams['tokenDepositData']
) => {
  // no token deposit associated with the ticket at all
  if (tokenDepositData === undefined) return true
  // a token deposit whose amount could not be resolved must not be treated
  // as zero — it may carry real funds
  if (!tokenDepositData.tokenAmount) return false
  return isZeroAmount(tokenDepositData.tokenAmount)
}

/**
 * A ticket is zero-value when it carries no child chain callvalue and no token
 * deposit — no user funds are at risk. These are almost always automated
 * system traffic (e.g. keeper contracts on high-volume chains), so they are
 * rolled into a single per-chain digest instead of one Slack alert per ticket.
 */
export const isZeroValueTicket = ({
  childChainRetryableReport,
  tokenDepositData,
}: Pick<
  OnFailedRetryableFoundParams,
  'childChainRetryableReport' | 'tokenDepositData'
>): boolean =>
  isZeroAmount(childChainRetryableReport.deposit) &&
  tokenDepositIsZero(tokenDepositData)

const ticketsByChainId = new Map<number, OnFailedRetryableFoundParams[]>()

export const addTicketToZeroValueDigest = (
  ticket: OnFailedRetryableFoundParams
) => {
  const { chainId } = ticket.childChain
  const tickets = ticketsByChainId.get(chainId) ?? []
  tickets.push(ticket)
  ticketsByChainId.set(chainId, tickets)
}

export const STATUS_LABELS: Record<string, string> = {
  FUNDS_DEPOSITED_ON_CHILD: 'created but not redeemed',
  CREATION_FAILED: 'creation failed',
  EXPIRED: 'expired',
  NOT_YET_CREATED: 'not yet scheduled',
}

export const countBy = (
  tickets: OnFailedRetryableFoundParams[],
  getKey: (ticket: OnFailedRetryableFoundParams) => string
): [string, number][] => {
  const counts = new Map<string, number>()
  for (const ticket of tickets) {
    const key = getKey(ticket)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

export const buildZeroValueDigestMessage = (
  childChain: ChildNetwork,
  tickets: OnFailedRetryableFoundParams[]
): string => {
  const { CHILD_CHAIN_TX_PREFIX } = getExplorerUrlPrefixes(childChain)

  const statusCounts = countBy(
    tickets,
    t =>
      STATUS_LABELS[t.childChainRetryableReport.status] ??
      t.childChainRetryableReport.status
  )
  const senderCounts = countBy(tickets, t => t.parentChainRetryableReport.sender)
  const listedSenders = senderCounts.slice(0, MAX_SENDERS_LISTED)
  const senderOverflow =
    senderCounts.length > MAX_SENDERS_LISTED
      ? `, …and ${senderCounts.length - MAX_SENDERS_LISTED} more senders`
      : ''

  // CREATION_FAILED tickets were never created, so they have no expiry — the
  // timeoutTimestamp on their report is a synthetic createdAt+lifetime value
  const expiringTickets = tickets.filter(
    t => t.childChainRetryableReport.status !== 'CREATION_FAILED'
  )
  const earliestExpiryLine = expiringTickets.length
    ? `\n\t *Earliest expiry:* ${timestampToDate(
        Math.min(
          ...expiringTickets.map(t =>
            Number(t.childChainRetryableReport.timeoutTimestamp)
          )
        )
      )}`
    : ''

  const ticketLines = tickets
    .slice(0, MAX_TICKETS_LISTED)
    .map(t => {
      const report = t.childChainRetryableReport
      const expiry =
        report.status === 'CREATION_FAILED'
          ? 'never created, no expiry'
          : `expires ${timestampToDate(+report.timeoutTimestamp)}`
      return `\n\t\t <${CHILD_CHAIN_TX_PREFIX + report.id}|${report.id}> — ${expiry}`
    })
    .join('')
  const overflowLine =
    tickets.length > MAX_TICKETS_LISTED
      ? `\n\t\t …and ${tickets.length - MAX_TICKETS_LISTED} more`
      : ''

  return (
    `*[${childChain.name}] ${tickets.length} zero-value retryable${
      tickets.length === 1 ? '' : 's'
    } (no callvalue, no tokens) — digest:*` +
    `\n\t *By status:* ${statusCounts
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ')}` +
    `\n\t *By sender:* ${listedSenders
      .map(([sender, count]) => `${sender}: ${count}`)
      .join(', ')}${senderOverflow}` +
    earliestExpiryLine +
    `\n\t *Tickets:*${ticketLines}${overflowLine}` +
    `\n\t Full details are in the run's retryable report JSON artifact.` +
    '\n================================================================='
  )
}

export const postZeroValueDigest = async (childChain: ChildNetwork) => {
  const tickets = ticketsByChainId.get(childChain.chainId)
  ticketsByChainId.delete(childChain.chainId)

  if (!tickets || tickets.length === 0) return

  try {
    await postSlackMessage({
      message: buildZeroValueDigestMessage(childChain, tickets),
    })
  } catch (e) {
    console.log('Could not send zero-value digest slack message', e)
  }
}
