import { notionClient, databaseId } from './createNotionClient'
import { postSlackMessage } from '../slack/postSlackMessage'
import {
  redeemRetryable,
  getLiveRetryableStatus,
  NOTION_EXECUTED_STATUS,
  REDEEMABLE_STATUS,
} from '../../core/redeemRetryable'
import { DEFAULT_CONFIG_PATH, type ChildNetwork } from 'utils'

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

// Notion's ParentTx property stores the explorer URL, not the raw hash
export const extractTxHash = (value: string | undefined) =>
  value?.match(/0x[a-fA-F0-9]{64}/)?.[0] ?? null

const isNearExpiry = (iso: string | undefined, hours = 24) => {
  if (!iso) return false
  const expiry = new Date(iso).getTime()
  const now = Date.now()
  const timeLeftMs = expiry - now
  return timeLeftMs > 0 && timeLeftMs <= hours * 60 * 60 * 1000
}

export const alertUntriagedNotionRetryables = async (
  childChains: ChildNetwork[] = [],
  enableAutoRedeem = false,
  configPath: string = DEFAULT_CONFIG_PATH
) => {
  const allowedChainIds = childChains.map(c => c.chainId)
  const response = await notionClient.databases.query({
    database_id: databaseId,
    page_size: 100,
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

    // skip if chainId not in allowed list
    const chainIdRaw = props?.ChainID?.number
    if (allowedChainIds.length > 0 && !allowedChainIds.includes(chainIdRaw)) {
      continue
    }

    const status = props?.Status?.select?.name || '(unknown)'
    if (status?.toLowerCase() === 'expired') continue

    const timeoutRaw = props?.timeoutTimestamp?.date?.start
    const timeoutStr = formatDate(timeoutRaw)
    const retryableUrl =
      props?.ChildTx?.title?.[0]?.text?.content || '(unknown)'
    const parentTx =
      props?.ParentTx?.rich_text?.[0]?.text?.content || '(unknown)'

    const l2CallValue = props?.L2CallValue?.rich_text?.[0]?.text?.content || ''
    const tokenDeposit =
      props?.TokensDeposited?.rich_text?.[0]?.text?.content || ''

    const deposit =
      [l2CallValue, tokenDeposit]
        .filter(s => s && s !== '0.0 ETH ($0.00)')
        .join(' and ') || '(unknown)'

    const decision = props?.Decision?.select?.name || '(unknown)'

    const now = Date.now()
    const expiryTime = timeoutRaw ? new Date(timeoutRaw).getTime() : Infinity
    const hoursLeft = (expiryTime - now) / (1000 * 60 * 60)

    // If a timeout exists and it's already past, skip
    if (Number.isFinite(hoursLeft) && hoursLeft < 0) continue

    let message = ''

    if (decision === 'Triage') {
      if (hoursLeft <= 72) {
        message = `🚨🚨 Retryable ticket needs IMMEDIATE triage (expires soon!):\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n• Parent Tx: ${parentTx}\n• Total value deposited: ${deposit}\n→ Please triage urgently.`
      } else {
        message = `⚠️ Retryable ticket needs triage:\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n• Parent Tx: ${parentTx}\n• Total value deposited: ${deposit}\n→ Please review and decide whether to redeem or ignore.`
      }
    } else if (decision === 'Should Redeem') {
      const under24HoursLeftToExpire = timeoutRaw
        ? isNearExpiry(timeoutRaw, 24)
        : false

      if (under24HoursLeftToExpire) {
        message = `🚨 Retryable marked for redemption and nearing expiry:\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n• Parent Tx: ${parentTx}\n• Total value deposited: ${deposit}\n→ Check why it hasn't been executed.`
      } else if (hoursLeft <= 96) {
        if (!enableAutoRedeem) continue

        const parentTxHash = extractTxHash(parentTx)
        const retryableCreationId = extractTxHash(retryableUrl)
        // without the row's own ticket id we could redeem a sibling
        if (!parentTxHash || !retryableCreationId) {
          console.error(
            `[notion] skipping auto-redeem, could not read tx hashes (parent: "${parentTx}", ticket: "${retryableUrl}")`
          )
          continue
        }

        const locator = { configPath, retryableCreationId, chainId: chainIdRaw }

        // the row may predate a redemption by anyone, so trust the chain
        let liveStatus: string | null = null
        try {
          liveStatus = await getLiveRetryableStatus(parentTxHash, locator)
        } catch (err) {
          console.error(
            `[notion] could not read live status for ${retryableUrl}:`,
            err
          )
        }

        if (liveStatus && liveStatus !== status) {
          console.log(
            `[notion] ${retryableUrl} status ${status} -> ${liveStatus}`
          )
          await notionClient.pages.update({
            page_id: page.id,
            properties: { Status: { select: { name: liveStatus } } },
          })
        }

        // only redeem on a confirmed redeemable status; a failed lookup is not
        // evidence the ticket is redeemable
        if (liveStatus !== REDEEMABLE_STATUS) {
          console.log(
            `[notion] skipping auto-redeem for ${retryableUrl}, status is ${
              liveStatus ?? 'unknown'
            }`
          )
          continue
        }

        try {
          await redeemRetryable(parentTxHash, locator)
          await notionClient.pages.update({
            page_id: page.id,
            properties: {
              Status: { select: { name: NOTION_EXECUTED_STATUS } },
              'Bot Redemption Status': {
                select: { name: 'Bot Success' },
              },
            },
          })
        } catch (err) {
          console.error(`[notion] auto-redeem failed for ${parentTxHash}:`, err)
          await notionClient.pages.update({
            page_id: page.id,
            properties: {
              'Bot Redemption Status': {
                select: { name: 'Bot Failed' },
              },
            },
          })
        }
        continue
      } else {
        continue
      }
    }

    if (!message) continue
    try {
      await postSlackMessage({ message })
    } catch {
      // swallow Slack errors to keep loop running
    }
  }
}
