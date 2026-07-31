import { BigNumber, ethers, providers } from 'ethers'
import { ChildNetwork, getExplorerUrlPrefixes } from 'utils'
import { OnFailedRetryableFoundParams } from '../core/types'
import { postSlackMessage } from './slack/postSlackMessage'
import {
  timestampToDate,
  getEthPrice,
} from './slack/slackMessageFormattingUtils'
import { generateFailedRetryableSlackMessage } from './slack/slackMessageGenerator'
import { countBy, STATUS_LABELS, shortTicketId } from './zeroValueTicketDigest'

// up to this many funded tickets per chain per run get the full per-ticket
// alert; beyond that the run posts a single digest instead, so a burst of
// deposits (e.g. a misconfigured depositor bot) doesn't flood the channel
export const MAX_INDIVIDUAL_FUNDED_ALERTS = 5
// Slack splits messages around ~4k characters (URLs included), so the cap
// keeps the digest a single message; the full list is in the JSON report
const MAX_TICKETS_LISTED = 10
const MAX_SENDERS_LISTED = 5

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')

const compactUtcDate = (tsSeconds: number): string => {
  const d = new Date(tsSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())} UTC`
}

const ticketsByChainId = new Map<number, OnFailedRetryableFoundParams[]>()

export const addTicketToFundedDigest = (
  ticket: OnFailedRetryableFoundParams
) => {
  const { chainId } = ticket.childChain
  const tickets = ticketsByChainId.get(chainId) ?? []
  tickets.push(ticket)
  ticketsByChainId.set(chainId, tickets)
}

const callvalueOf = (ticket: OnFailedRetryableFoundParams): BigNumber =>
  BigNumber.from(ticket.childChainRetryableReport.l2CallValue ?? '0')

const formatAmount = (
  wei: BigNumber,
  unit: string,
  ethPriceUsd?: number
): string => {
  const exact = parseFloat(ethers.utils.formatEther(wei))
  // 6 decimals is plenty for a summary; the JSON report has exact wei values
  const amount = String(Number(exact.toFixed(6)))
  if (ethPriceUsd === undefined) return `${amount} ${unit}`
  const usd = exact * ethPriceUsd
  return `${amount} ${unit} (~$${usd.toFixed(2)})`
}

const formatTimeLeft = (untilSeconds: number): string => {
  const secondsLeft = untilSeconds - Math.floor(Date.now() / 1000)
  if (secondsLeft <= 0) return 'already passed'
  const days = Math.floor(secondsLeft / (24 * 60 * 60))
  const hours = Math.floor((secondsLeft % (24 * 60 * 60)) / (60 * 60))
  return `in ${days}d ${hours}h`
}

const formatArtifactPointer = (): string => {
  const repository = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  if (repository && runId) {
    return `\n\t ⚠️ Please check the *retryable-run-report.json* artifact on <https://github.com/${repository}/actions/runs/${runId}|this run> urgently for full per-ticket redemption details.`
  }
  return `\n\t ⚠️ Please check *retryable-run-report.json* in the run's working directory urgently for full per-ticket redemption details.`
}

export const buildFundedDigestMessage = async (
  childChain: ChildNetwork,
  tickets: OnFailedRetryableFoundParams[]
): Promise<string> => {
  const { CHILD_CHAIN_TX_PREFIX } = getExplorerUrlPrefixes(childChain)

  // custom gas-token chains denominate callvalue in the chain's gas token,
  // for which the cached ETH price would be wrong
  const unit = childChain.nativeToken ? 'gas tokens' : 'ETH'
  let ethPriceUsd: number | undefined = undefined
  if (!childChain.nativeToken) {
    try {
      ethPriceUsd = await getEthPrice()
    } catch {
      // the digest must still post when the price API is down
    }
  }

  const totalCallvalue = tickets.reduce(
    (sum, t) => sum.add(callvalueOf(t)),
    BigNumber.from(0)
  )
  const averageCallvalue = totalCallvalue.div(tickets.length)
  const largestCallvalue = tickets.reduce(
    (max, t) => (callvalueOf(t).gt(max) ? callvalueOf(t) : max),
    BigNumber.from(0)
  )
  const tokenDepositCount = tickets.filter(t =>
    Boolean(t.tokenDepositData?.tokenAmount)
  ).length

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
  const distinctDestinations = new Set(
    tickets.map(t => t.childChainRetryableReport.retryTo)
  ).size

  const timeouts = tickets.map(t =>
    Number(t.childChainRetryableReport.timeoutTimestamp)
  )
  const earliestExpiry = Math.min(...timeouts)
  const latestExpiry = Math.max(...timeouts)

  const ticketLines = tickets
    .slice(0, MAX_TICKETS_LISTED)
    .map(t => {
      const report = t.childChainRetryableReport
      const tokenMarker = t.tokenDepositData?.tokenAmount ? ' + tokens' : ''
      return `\n\t\t <${CHILD_CHAIN_TX_PREFIX + report.id}|${shortTicketId(
        report.id
      )}> — ${ethers.utils.formatEther(
        callvalueOf(t)
      )} ${unit}${tokenMarker} — expires ${compactUtcDate(
        +report.timeoutTimestamp
      )}`
    })
    .join('')
  const overflowLine =
    tickets.length > MAX_TICKETS_LISTED
      ? `\n\t\t …and ${tickets.length - MAX_TICKETS_LISTED} more`
      : ''

  return (
    `🚨 *[${childChain.name}] URGENT: ${tickets.length} unredeemed retryable${
      tickets.length === 1 ? '' : 's'
    } with funds at risk.*` +
    `\n\t Sending a summary instead of individual alerts to avoid spam, since the ticket count exceeds ${MAX_INDIVIDUAL_FUNDED_ALERTS}.` +
    `\n\t *Summary:*` +
    `\n\t *Total unredeemed:* ${formatAmount(
      totalCallvalue,
      unit,
      ethPriceUsd
    )}${
      tokenDepositCount > 0
        ? ` (+${tokenDepositCount} ticket${
            tokenDepositCount === 1 ? '' : 's'
          } with token deposits)`
        : ''
    }` +
    `\n\t *Average per ticket:* ${formatAmount(
      averageCallvalue,
      unit,
      ethPriceUsd
    )} | *Largest:* ${formatAmount(largestCallvalue, unit, ethPriceUsd)}` +
    `\n\t *By status:* ${statusCounts
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ')}` +
    `\n\t *By sender:* ${listedSenders
      .map(([sender, count]) => `${sender}: ${count}`)
      .join(', ')}${senderOverflow} | *Distinct destinations:* ${distinctDestinations}` +
    `\n\t *Expiry window:* earliest ${timestampToDate(
      earliestExpiry
    )} (${formatTimeLeft(earliestExpiry)}) → latest ${timestampToDate(
      latestExpiry
    )} (${formatTimeLeft(latestExpiry)})` +
    `\n\t *Tickets:*${ticketLines}${overflowLine}` +
    formatArtifactPointer() +
    '\n================================================================='
  )
}

/**
 * Flushes the funded tickets accumulated for a chain during the run. Up to
 * MAX_INDIVIDUAL_FUNDED_ALERTS tickets get the usual detailed per-ticket
 * alert; a larger batch is rolled into a single digest message.
 */
export const postFundedTicketAlerts = async (childChain: ChildNetwork) => {
  const tickets = ticketsByChainId.get(childChain.chainId)
  ticketsByChainId.delete(childChain.chainId)

  if (!tickets || tickets.length === 0) return

  if (tickets.length > MAX_INDIVIDUAL_FUNDED_ALERTS) {
    try {
      await postSlackMessage({
        message: await buildFundedDigestMessage(childChain, tickets),
      })
    } catch (e) {
      console.log('Could not send funded-ticket digest slack message', e)
    }
    return
  }

  const childChainProvider = new providers.JsonRpcProvider(
    String(childChain.orbitRpcUrl)
  )
  const parentChainProvider = new providers.JsonRpcProvider(
    String(childChain.parentRpcUrl)
  )

  for (const ticket of tickets) {
    try {
      const message = await generateFailedRetryableSlackMessage({
        parentChainRetryableReport: ticket.parentChainRetryableReport,
        childChainRetryableReport: ticket.childChainRetryableReport,
        tokenDepositData: ticket.tokenDepositData,
        childChain,
        parentChainProvider,
        childChainProvider,
      })
      await postSlackMessage({ message })
    } catch (e) {
      console.log('Could not send slack message', e)
    }
  }
}
