import { ParentToChildMessageStatus } from '@arbitrum/sdk'

export const NOTION_STATUS = {
  EXECUTED: 'Executed',
} as const

export const NOTION_DECISION = {
  TRIAGE: 'Triage',
  SHOULD_REDEEM: 'Should Redeem',
  FORCE_REDEEM: 'Force Redeem',
  REDEEMED: 'Redeemed',
} as const

export type RetryableDecision =
  | typeof NOTION_DECISION.TRIAGE
  | typeof NOTION_DECISION.SHOULD_REDEEM
  | typeof NOTION_DECISION.FORCE_REDEEM

export const isRetryableDecision = (
  value: string | undefined
): value is RetryableDecision =>
  value === NOTION_DECISION.TRIAGE ||
  value === NOTION_DECISION.SHOULD_REDEEM ||
  value === NOTION_DECISION.FORCE_REDEEM

export const retryableStatusToNotion = (
  status: ParentToChildMessageStatus
): string =>
  status === ParentToChildMessageStatus.REDEEMED
    ? NOTION_STATUS.EXECUTED
    : ParentToChildMessageStatus[status]
