import { ParentToChildMessageStatus } from '@arbitrum/sdk'
import { describe, expect, test } from 'vitest'
import { NotionRetryableRow } from '../handlers/notion/notionRetryableRows'
import { NOTION_DECISION } from '../handlers/notion/notionVocabulary'
import {
  AUTO_REDEEM_DELAY_MS,
  AUTO_REDEEM_RETRY_DELAY_MS,
  decideRetryableAction,
} from '../handlers/notion/retryableSweepPolicy'

const NOW = Date.UTC(2026, 8, 22)
const DAY_MS = 24 * 60 * 60 * 1000
const REDEEMABLE = ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD

const row = (
  overrides: Partial<NotionRetryableRow> = {}
): NotionRetryableRow => ({
  id: 'page-1',
  chainId: 42161,
  status: 'FUNDS_DEPOSITED_ON_CHILD',
  decision: NOTION_DECISION.SHOULD_REDEEM,
  parentTx: 'parent',
  retryableUrl: 'ticket',
  createdAtMs: NOW - AUTO_REDEEM_DELAY_MS,
  timeoutMs: NOW + 3 * DAY_MS,
  deposit: '1 ETH',
  ...overrides,
})

describe('decideRetryableAction', () => {
  test.each([
    [ParentToChildMessageStatus.CREATION_FAILED],
    [ParentToChildMessageStatus.REDEEMED],
    [ParentToChildMessageStatus.EXPIRED],
  ])('skips terminal chain status %s', liveStatus => {
    expect(decideRetryableAction(row(), liveStatus, true, NOW)).toEqual({
      type: 'skip',
    })
  })

  test('alerts triage rows and escalates them three days before expiry', () => {
    const action = decideRetryableAction(
      row({ decision: NOTION_DECISION.TRIAGE, timeoutMs: NOW + DAY_MS }),
      REDEEMABLE,
      false,
      NOW
    )
    expect(action).toMatchObject({ type: 'alert' })
    expect(action.type === 'alert' && action.message).toContain(
      'IMMEDIATE triage'
    )
  })

  test('does not alert a triage row past its stored timeout', () => {
    expect(
      decideRetryableAction(
        row({ decision: NOTION_DECISION.TRIAGE, timeoutMs: NOW - 1 }),
        null,
        false,
        NOW
      )
    ).toEqual({ type: 'skip' })
  })

  test('alerts when the chain confirms a triage row is still live past timeout', () => {
    expect(
      decideRetryableAction(
        row({ decision: NOTION_DECISION.TRIAGE, timeoutMs: NOW - 1 }),
        REDEEMABLE,
        false,
        NOW
      )
    ).toMatchObject({ type: 'alert' })
  })

  test('alerts near expiry when the chain read failed', () => {
    expect(
      decideRetryableAction(row({ timeoutMs: NOW + DAY_MS }), null, true, NOW)
    ).toMatchObject({ type: 'alert' })
  })

  test('stays quiet after a failed read when expiry is not near', () => {
    expect(decideRetryableAction(row(), null, true, NOW)).toEqual({
      type: 'skip',
    })
  })

  test('alerts after a failed read when expiry metadata is missing', () => {
    expect(
      decideRetryableAction(row({ timeoutMs: undefined }), null, true, NOW)
    ).toMatchObject({ type: 'alert' })
  })

  test('alerts near expiry when auto-redemption is disabled', () => {
    expect(
      decideRetryableAction(
        row({ timeoutMs: NOW + DAY_MS }),
        REDEEMABLE,
        false,
        NOW
      )
    ).toMatchObject({ type: 'alert' })
  })

  test('waits four days before redeeming a policy row', () => {
    expect(
      decideRetryableAction(
        row({ createdAtMs: NOW - AUTO_REDEEM_DELAY_MS + 1 }),
        REDEEMABLE,
        true,
        NOW
      )
    ).toEqual({ type: 'skip' })
    expect(decideRetryableAction(row(), REDEEMABLE, true, NOW)).toEqual({
      type: 'redeem',
    })
  })

  test('force redemption bypasses the age and retry delay', () => {
    expect(
      decideRetryableAction(
        row({
          decision: NOTION_DECISION.FORCE_REDEEM,
          createdAtMs: NOW,
          lastEditedMs: NOW,
          botRedemptionStatus: 'Bot Failed',
        }),
        REDEEMABLE,
        true,
        NOW
      )
    ).toEqual({ type: 'redeem' })
  })

  test('derives legacy creation time from timeout', () => {
    expect(
      decideRetryableAction(
        row({ createdAtMs: undefined, timeoutMs: NOW + 3 * DAY_MS }),
        REDEEMABLE,
        true,
        NOW
      )
    ).toEqual({ type: 'redeem' })
  })

  test('alerts instead of silencing a row with no timestamps', () => {
    const action = decideRetryableAction(
      row({ createdAtMs: undefined, timeoutMs: undefined }),
      REDEEMABLE,
      true,
      NOW
    )
    expect(action).toMatchObject({ type: 'alert' })
    expect(action.type === 'alert' && action.message).toContain('CreatedAt')
  })

  test('backs failed attempts off for one day', () => {
    const failed = row({
      botRedemptionStatus: 'Bot Failed',
      lastEditedMs: NOW - AUTO_REDEEM_RETRY_DELAY_MS + 1,
    })
    expect(decideRetryableAction(failed, REDEEMABLE, true, NOW)).toEqual({
      type: 'skip',
    })
    expect(
      decideRetryableAction(
        { ...failed, lastEditedMs: NOW - AUTO_REDEEM_RETRY_DELAY_MS },
        REDEEMABLE,
        true,
        NOW
      )
    ).toEqual({ type: 'redeem' })
  })

  test('trusts an already-expired row when the chain is unavailable', () => {
    expect(
      decideRetryableAction(row({ status: 'Expired' }), null, true, NOW)
    ).toEqual({ type: 'skip' })
  })
})
