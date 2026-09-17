import { notionClient, databaseId } from './createNotionClient'
import { postSlackMessage } from '../slack/postSlackMessage'
import {
  redeemRetryable,
  getLiveRetryableStatus,
  NOTION_EXECUTED_STATUS,
  NOTION_REDEEMED_DECISION,
  REDEEMABLE_STATUS,
} from '../../core/redeemRetryable'
import { DEFAULT_CONFIG_PATH, type ChildNetwork } from 'utils'
import { formatActionRunReference } from '../slack/slackMessageFormattingUtils'

export const TRIAGE_DECISION = 'Triage'
export const SHOULD_REDEEM_DECISION = 'Should Redeem'
export const FORCE_REDEEM_DECISION = 'Force Redeem'

// tickets live seven days; the bot waits four so a human still has time to set
// Ignore, and a failed attempt still has three days of daily retries left
export const AUTO_REDEEM_DELAY_DAYS = 4
const TICKET_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

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

  // keep unrelated chains out of every page returned to this run
  const chainScope = allowedChainIds.map(chainId => ({
    property: 'ChainID',
    number: { equals: chainId },
  }))
  const scopedToRun = (conditions: any[]) => ({
    and:
      chainScope.length > 0 ? [{ or: chainScope }, ...conditions] : conditions,
  })

  // two queries rather than one: Notion only nests compound filters two deep
  const filters = [
    scopedToRun([
      {
        or: [
          { property: 'Decision', select: { equals: SHOULD_REDEEM_DECISION } },
          { property: 'Decision', select: { equals: FORCE_REDEEM_DECISION } },
        ],
      },
    ]),
    scopedToRun([
      { property: 'Decision', select: { equals: TRIAGE_DECISION } },
      { property: 'Status', select: { does_not_equal: 'Executed' } },
    ]),
  ]

  const rows: any[] = []
  for (const filter of filters) {
    let cursor: string | undefined = undefined
    do {
      const response = await notionClient.databases.query({
        database_id: databaseId,
        page_size: 100,
        start_cursor: cursor,
        filter,
      })
      rows.push(...response.results)
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined
    } while (cursor)
  }

  const redeemedThisRun: string[] = []
  const writeFailures: string[] = []

  // a 429 or a malformed row must not end the sweep: the portal runs this once
  // a day, so an abort costs every later ticket a full retry window
  const updatePage = async (pageId: string, properties: any) => {
    try {
      await notionClient.pages.update({ page_id: pageId, properties })
      return true
    } catch (err) {
      console.error(`[notion] could not update ${pageId}:`, err)
      writeFailures.push(pageId)
      return false
    }
  }

  for (const page of rows) {
    const props = (page as any).properties

    const chainIdRaw = props?.ChainID?.number

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

    const isPastTimeout = Number.isFinite(hoursLeft) && hoursLeft < 0

    const createdAtRaw = props?.CreatedAt?.date?.start
    // rows written before CreatedAt existed fall back to the timeout; the
    // ticket lifetime is fixed, so it resolves to the same instant
    const createdAtMs = createdAtRaw
      ? new Date(createdAtRaw).getTime()
      : expiryTime - TICKET_LIFETIME_MS
    const daysSinceCreation = (now - createdAtMs) / (1000 * 60 * 60 * 24)

    let message = ''

    if (decision === TRIAGE_DECISION) {
      if (isPastTimeout) continue

      if (hoursLeft <= 72) {
        message = `🚨🚨 Retryable ticket needs IMMEDIATE triage (expires soon!):\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n• Parent Tx: ${parentTx}\n• Total value deposited: ${deposit}\n→ Please triage urgently.`
      } else {
        message = `⚠️ Retryable ticket needs triage:\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n• Parent Tx: ${parentTx}\n• Total value deposited: ${deposit}\n→ Please review and decide whether to redeem or ignore.`
      }
    } else if (
      decision === SHOULD_REDEEM_DECISION ||
      decision === FORCE_REDEEM_DECISION
    ) {
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

      // reconcile before the timeout branches decide anything: a row read only
      // by those branches alerts off stale Notion data in its last 24 hours
      // without the chain ever being consulted
      let liveStatus: string | null = null
      try {
        liveStatus = await getLiveRetryableStatus(parentTxHash, locator)
      } catch (err) {
        console.error(
          `[notion] could not read live status for ${retryableUrl}:`,
          err
        )
      }

      // a ticket redeemed by anyone, bot or not, is no longer ours to redeem
      const liveDecision =
        liveStatus === NOTION_EXECUTED_STATUS
          ? NOTION_REDEEMED_DECISION
          : decision

      const drift = {
        ...(liveStatus &&
          liveStatus !== status && {
            Status: { select: { name: liveStatus } },
          }),
        ...(liveDecision !== decision && {
          Decision: { select: { name: liveDecision } },
        }),
      }

      if (Object.keys(drift).length > 0) {
        console.log(
          `[notion] ${retryableUrl} ${status}/${decision} -> ${liveStatus}/${liveDecision}`
        )
        await updatePage(page.id, drift)
      }

      // only alert or redeem on a confirmed redeemable status; a failed lookup
      // is not evidence the ticket is redeemable
      if (liveStatus !== REDEEMABLE_STATUS) {
        console.log(
          `[notion] skipping ${retryableUrl}, status is ${
            liveStatus ?? 'unknown'
          }`
        )
        continue
      }

      if (!enableAutoRedeem) {
        // this run has no mandate to redeem, so a row a human marked for
        // redemption still needs the nearing-expiry nudge
        if (!isNearExpiry(timeoutRaw, 24)) continue
        message = `🚨 Retryable marked for redemption and nearing expiry:\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n• Parent Tx: ${parentTx}\n• Total value deposited: ${deposit}\n→ Check why it hasn't been executed.`
      } else if (
        decision === SHOULD_REDEEM_DECISION &&
        daysSinceCreation < AUTO_REDEEM_DELAY_DAYS
      ) {
        continue
      } else {
        // only the transaction belongs in this try: a redeem that succeeded is
        // a fact about the chain, and failing to write it down must not be
        // reported as a failed redemption
        let redeemFailed = false
        try {
          await redeemRetryable(parentTxHash, locator)
        } catch (err) {
          redeemFailed = true
          console.error(`[notion] auto-redeem failed for ${parentTxHash}:`, err)
        }

        if (!redeemFailed) {
          redeemedThisRun.push(retryableUrl)
          // if this write is lost the row stays redeemable and the next run
          // reconciles it against the chain, so it is safe to only log
          await updatePage(page.id, {
            Status: { select: { name: NOTION_EXECUTED_STATUS } },
            Decision: { select: { name: NOTION_REDEEMED_DECISION } },
            'Bot Redemption Status': { select: { name: 'Bot Success' } },
          })
          continue
        }

        await updatePage(page.id, {
          'Bot Redemption Status': { select: { name: 'Bot Failed' } },
        })
        message = `🚨 Auto-redemption FAILED:\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n• Parent Tx: ${parentTx}\n• Total value deposited: ${deposit}\n→ The bot retries on every run until the ticket expires. Set Decision to \`Ignore\` to silence this, or redeem manually.`
      }
    }

    if (!message) continue
    try {
      await postSlackMessage({ message })
    } catch {
      // swallow Slack errors to keep loop running
    }
  }

  if (redeemedThisRun.length > 0) {
    const ticketLines = redeemedThisRun.map(url => `\n• ${url}`).join('')
    try {
      await postSlackMessage({
        message: `✅ ${redeemedThisRun.length} retryable${
          redeemedThisRun.length === 1 ? '' : 's'
        } auto-redeemed${formatActionRunReference()} at ${formatDate(
          new Date().toISOString()
        )}:${ticketLines}`,
      })
    } catch {
      // swallow Slack errors; the redemptions already succeeded
    }
  }

  if (writeFailures.length > 0) {
    console.error(
      `[notion] ${
        writeFailures.length
      } row(s) could not be updated this run: ${writeFailures.join(', ')}`
    )
  }
}
