import { ParentToChildMessageStatus } from '@arbitrum/sdk'

export const NOTION_STATUS = {
  EXECUTED: 'Executed',
} as const

export const NOTION_DECISION = {
  REDEEMED: 'Redeemed',
} as const

export const retryableStatusToNotion = (
  status: ParentToChildMessageStatus
): string =>
  status === ParentToChildMessageStatus.REDEEMED
    ? NOTION_STATUS.EXECUTED
    : ParentToChildMessageStatus[status]
