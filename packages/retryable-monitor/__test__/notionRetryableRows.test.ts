import { describe, expect, test } from 'vitest'
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'
import { parseRetryableRow } from '../handlers/notion/notionRetryableRows'

const page = (decision = 'Should Redeem') =>
  ({
    id: 'page-1',
    last_edited_time: '2026-09-22T00:00:00.000Z',
    properties: {
      ChainID: { number: 42161 },
      Status: { select: { name: 'FUNDS_DEPOSITED_ON_CHILD' } },
      Decision: { select: { name: decision } },
      ParentTx: { rich_text: [{ plain_text: 'parent' }] },
      ChildTx: { title: [{ text: { content: 'ticket' } }] },
      CreatedAt: { date: null },
      timeoutTimestamp: { date: null },
      L2CallValue: { rich_text: [{ plain_text: '1 ETH' }] },
      TokensDeposited: { rich_text: [{ plain_text: '2 USDC' }] },
      'Bot Redemption Status': { select: { name: 'Bot Failed' } },
    },
  } as unknown as PageObjectResponse)

describe('parseRetryableRow', () => {
  test('parses both Notion text shapes without inventing timestamps', () => {
    expect(parseRetryableRow(page())).toEqual({
      id: 'page-1',
      chainId: 42161,
      status: 'FUNDS_DEPOSITED_ON_CHILD',
      decision: 'Should Redeem',
      parentTx: 'parent',
      retryableUrl: 'ticket',
      createdAtMs: undefined,
      timeoutMs: undefined,
      lastEditedMs: Date.parse('2026-09-22T00:00:00.000Z'),
      deposit: '1 ETH and 2 USDC',
      botRedemptionStatus: 'Bot Failed',
    })
  })

  test('rejects rows outside the sweep decisions', () => {
    expect(parseRetryableRow(page('Ignore'))).toBeNull()
    expect(parseRetryableRow(page('Redeemed'))).toBeNull()
  })
})
