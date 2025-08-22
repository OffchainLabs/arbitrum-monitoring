import { notionClient, databaseId } from './createNotionClient'
import { postSlackMessage } from '../slack/postSlackMessage'
import { redeemRetryable } from '../../core/redeemRetryable'
import type { ChildNetwork } from '../../../utils'

const formatDate = (iso: string | undefined) => {
  if (!iso) return '(unknown)'
  const date = new Date(iso)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date)
}

const isNearExpiry = (iso: string | undefined, hours = 24) => {
  if (!iso) return false
  const expiry = new Date(iso).getTime()
  const now = Date.now()
  const timeLeftMs = expiry - now
  return timeLeftMs > 0 && timeLeftMs <= hours * 60 * 60 * 1000
}

export const alertUntriagedNotionRetryables = async (
  childChains: ChildNetwork[] = []
) => {
  const allowedChainIds = childChains.map(c => c.chainId)

  let startCursor: string | undefined = undefined
  do {
    const response = await notionClient.databases.query({
      database_id: databaseId,
      page_size: 100,
      start_cursor: startCursor,
      filter: {
        and: [
          {
            or: [
              { property: 'Decision', select: { equals: 'Triage' } },
              { property: 'Decision', select: { equals: 'Should Redeem' } },
            ],
          },
          {
            property: 'Status',
            select: { does_not_equal: 'Executed' },
          },
        ],
      },
    })

    for (const page of response.results) {
      const props = (page as any).properties

      // chain allowlist
      const chainIdRaw = props?.ChainID?.number
      if (allowedChainIds.length > 0 && !allowedChainIds.includes(chainIdRaw)) {
        continue
      }

      // expired rows are skipped
      const status = props?.Status?.select?.name || '(unknown)'
      if (status?.toLowerCase() === 'expired') continue

      const timeoutRaw = props?.timeoutTimestamp?.date?.start
      const timeoutStr = formatDate(timeoutRaw)
      const retryableUrl =
        props?.ChildTx?.title?.[0]?.text?.content || '(unknown)'
      const parentTx =
        props?.ParentTx?.rich_text?.[0]?.text?.content || '(unknown)'

      const ethDeposit =
        props?.TotalRetryableDeposit?.rich_text?.[0]?.text?.content || ''
      const tokenDeposit =
        props?.TokensDeposited?.rich_text?.[0]?.text?.content || ''
      const deposit =
        [ethDeposit, tokenDeposit]
          .filter(s => s && s !== '0.0 ETH ($0.00)')
          .join(' and ') || '(unknown)'

      const decision = props?.Decision?.select?.name || '(unknown)'

      // only care about the two tracked decisions
      if (decision !== 'Triage' && decision !== 'Should Redeem') continue

      const now = Date.now()
      const expiryTime = timeoutRaw ? new Date(timeoutRaw).getTime() : Infinity
      const hoursLeft = (expiryTime - now) / (1000 * 60 * 60)

      // if timeout exists and already past, skip
      if (Number.isFinite(hoursLeft) && hoursLeft < 0) continue

      let message = ''

      if (decision === 'Triage') {
        if (hoursLeft <= 72) {
          message = `🚨🚨 Retryable ticket needs IMMEDIATE triage (expires soon!):\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n• Parent Tx: ${parentTx}\n• Total value deposited: ${deposit}\n→ Please triage urgently.`
        } else {
          message = `⚠️ Retryable ticket needs triage:\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n• Parent Tx: ${parentTx}\n• Total value deposited: ${deposit}\n→ Please review and decide whether to redeem or ignore.`
        }
      } else if (decision === 'Should Redeem') {
        const under24HoursLeftToExpire = timeoutRaw ? isNearExpiry(timeoutRaw, 24) : false
        const moreThan4DaysLeftToExpire = timeoutRaw ? hoursLeft > 96 : false

        if (under24HoursLeftToExpire) {
          message = `🚨 Retryable marked for redemption and nearing expiry:\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n• Parent Tx: ${parentTx}\n• Total value deposited: ${deposit}\n→ Check why it hasn't been executed.`
        } else if (moreThan4DaysLeftToExpire) {
          try {
            await redeemRetryable(parentTx)
            await notionClient.pages.update({
              page_id: page.id,
              properties: {
                'Bot Redemption Status': { select: { name: 'Bot Success' } },
              },
            })
          } catch (err) {
            await notionClient.pages.update({
              page_id: page.id,
              properties: {
                'Bot Redemption Status': { select: { name: 'Bot Failed' } },
              },
            })
          }
          continue // no Slack message
        } else {
          continue // not under 24h or over 4d, skip
        }
      }

      if (!message) continue
      try {
        await postSlackMessage({ message })
      } catch {
        // swallow Slack send errors to avoid breaking the loop
      }
    }

    startCursor = (response as any).has_more ? (response as any).next_cursor : undefined
  } while (startCursor)
}
