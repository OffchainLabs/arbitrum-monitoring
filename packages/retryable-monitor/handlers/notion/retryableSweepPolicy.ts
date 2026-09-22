import { ParentToChildMessageStatus } from '@arbitrum/sdk'
import type { NotionRetryableRow } from './notionRetryableRows'
import { NOTION_DECISION, type RetryableDecision } from './notionVocabulary'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const TICKET_LIFETIME_MS = 7 * DAY_MS
export const AUTO_REDEEM_DELAY_MS = 4 * DAY_MS
export const AUTO_REDEEM_RETRY_DELAY_MS = DAY_MS

export type SweepAction =
  | { type: 'skip' }
  | { type: 'redeem' }
  | { type: 'alert'; message: string }

const formatDate = (timestamp: number | undefined) =>
  timestamp === undefined
    ? '(unknown)'
    : new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
        timeZoneName: 'short',
      }).format(timestamp)

const details = (row: NotionRetryableRow) =>
  `• Retryable: ${row.retryableUrl}\n• Timeout: ${formatDate(
    row.timeoutMs
  )}\n• Parent Tx: ${row.parentTx}\n• Total value deposited: ${row.deposit}`

const alert = (row: NotionRetryableRow, heading: string, action: string) => ({
  type: 'alert' as const,
  message: `${heading}:\n${details(row)}\n→ ${action}`,
})

const triage = (
  row: NotionRetryableRow,
  liveStatus: ParentToChildMessageStatus | null,
  nowMs: number
): SweepAction => {
  if (
    liveStatus === null &&
    row.timeoutMs !== undefined &&
    row.timeoutMs < nowMs
  ) {
    return { type: 'skip' }
  }
  if (row.timeoutMs !== undefined && row.timeoutMs - nowMs <= 3 * DAY_MS) {
    return alert(
      row,
      '🚨🚨 Retryable ticket needs IMMEDIATE triage (expires soon!)',
      'Please triage urgently.'
    )
  }
  return alert(
    row,
    '⚠️ Retryable ticket needs triage',
    'Please review and decide whether to redeem or ignore.'
  )
}

const nearingExpiry = (row: NotionRetryableRow, nowMs: number) =>
  row.timeoutMs !== undefined &&
  row.timeoutMs > nowMs &&
  row.timeoutMs - nowMs <= DAY_MS

type PolicyContext = {
  row: NotionRetryableRow
  liveStatus: ParentToChildMessageStatus | null
  autoRedeem: boolean
  nowMs: number
}

const redeemDecision = (
  { row, liveStatus, autoRedeem, nowMs }: PolicyContext,
  force: boolean
): SweepAction => {
  if (liveStatus === null || !autoRedeem) {
    if (row.timeoutMs === undefined) {
      return alert(
        row,
        '🚨 Retryable marked for redemption with no expiry',
        'Restore timeoutTimestamp and check the ticket on-chain.'
      )
    }
    return nearingExpiry(row, nowMs)
      ? alert(
          row,
          '🚨 Retryable marked for redemption and nearing expiry',
          liveStatus === null
            ? "Live status could not be read. Check why it hasn't been executed."
            : "Check why it hasn't been executed."
        )
      : { type: 'skip' }
  }
  if (force) return { type: 'redeem' }

  const createdAtMs =
    row.createdAtMs ??
    (row.timeoutMs === undefined
      ? undefined
      : row.timeoutMs - TICKET_LIFETIME_MS)
  if (createdAtMs === undefined) {
    return alert(
      row,
      '🚨 Retryable cannot be scheduled for auto-redemption',
      'Set CreatedAt or timeoutTimestamp, or change Decision to Force Redeem.'
    )
  }
  if (nowMs - createdAtMs < AUTO_REDEEM_DELAY_MS) return { type: 'skip' }
  if (
    row.botRedemptionStatus === 'Bot Failed' &&
    nowMs - (row.lastEditedMs ?? 0) < AUTO_REDEEM_RETRY_DELAY_MS
  ) {
    return { type: 'skip' }
  }
  return { type: 'redeem' }
}

const policies: Record<
  RetryableDecision,
  (context: PolicyContext) => SweepAction
> = {
  [NOTION_DECISION.TRIAGE]: ({ row, liveStatus, nowMs }) =>
    triage(row, liveStatus, nowMs),
  [NOTION_DECISION.SHOULD_REDEEM]: context => redeemDecision(context, false),
  [NOTION_DECISION.FORCE_REDEEM]: context => redeemDecision(context, true),
}

export const decideRetryableAction = (
  row: NotionRetryableRow,
  liveStatus: ParentToChildMessageStatus | null,
  autoRedeem: boolean,
  nowMs = Date.now()
): SweepAction => {
  const redeemable = ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD
  if (liveStatus !== null && liveStatus !== redeemable) return { type: 'skip' }
  if (liveStatus === null && row.status.toLowerCase() === 'expired') {
    return { type: 'skip' }
  }
  return policies[row.decision]({ row, liveStatus, autoRedeem, nowMs })
}
