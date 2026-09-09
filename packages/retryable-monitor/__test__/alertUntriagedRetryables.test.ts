import { beforeEach, describe, expect, test, vi } from 'vitest'

const databasesQuery = vi.fn()
const pagesUpdate = vi.fn()

vi.mock('../handlers/notion/createNotionClient', () => ({
  notionClient: {
    databases: { query: (...args: unknown[]) => databasesQuery(...args) },
    pages: { update: (...args: unknown[]) => pagesUpdate(...args) },
  },
  databaseId: 'test-db',
}))

vi.mock('../core/redeemRetryable', () => ({
  redeemRetryable: vi.fn(),
  getLiveRetryableStatus: vi.fn(),
  NOTION_EXECUTED_STATUS: 'Executed',
  NOTION_REDEEMED_DECISION: 'Redeemed',
  REDEEMABLE_STATUS: 'FUNDS_DEPOSITED_ON_CHILD',
}))

vi.mock('../handlers/slack/postSlackMessage', () => ({
  postSlackMessage: vi.fn(),
}))

import {
  alertUntriagedNotionRetryables,
  extractTxHash,
} from '../handlers/notion/alertUntriagedRetraybles'
import {
  redeemRetryable,
  getLiveRetryableStatus,
} from '../core/redeemRetryable'

const PARENT_TX_HASH =
  '0xe60d848b8fae81b103135825c30c2ca169170100cad7fbdf3e73d062e3fc90d6'
const CHILD_TX_HASH =
  '0xa0922360dad7e9d29b6aecd543f323cb9524e30edd2d1a45d758fcd8fa786a9e'

const CHAINS = [{ chainId: 42161 }] as any

const buildPage = (
  hoursUntilExpiry: number,
  childTx = `https://robinhoodchain.blockscout.com/tx/${CHILD_TX_HASH}`
) => ({
  id: 'page-1',
  properties: {
    ChainID: { number: 42161 },
    Status: { select: { name: 'FUNDS_DEPOSITED_ON_CHILD' } },
    Decision: { select: { name: 'Should Redeem' } },
    ParentTx: {
      rich_text: [
        { text: { content: `https://etherscan.io/tx/${PARENT_TX_HASH}` } },
      ],
    },
    ChildTx: { title: [{ text: { content: childTx } }] },
    timeoutTimestamp: {
      date: {
        start: new Date(
          Date.now() + hoursUntilExpiry * 60 * 60 * 1000
        ).toISOString(),
      },
    },
  },
})

describe('extractTxHash', () => {
  test('pulls the hash out of an explorer URL', () => {
    expect(extractTxHash(`https://etherscan.io/tx/${PARENT_TX_HASH}`)).toBe(
      PARENT_TX_HASH
    )
  })

  test('passes a raw hash through', () => {
    expect(extractTxHash(PARENT_TX_HASH)).toBe(PARENT_TX_HASH)
  })

  test('returns null when there is no hash', () => {
    expect(extractTxHash('(unknown)')).toBeNull()
    expect(extractTxHash(undefined)).toBeNull()
  })
})

describe('alertUntriagedNotionRetryables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    databasesQuery.mockResolvedValue({ results: [buildPage(48)] })
    vi.mocked(getLiveRetryableStatus).mockResolvedValue(
      'FUNDS_DEPOSITED_ON_CHILD'
    )
  })

  test('redeems with the raw hash, not the explorer URL', async () => {
    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).toHaveBeenCalledWith(
      PARENT_TX_HASH,
      expect.objectContaining({
        retryableCreationId: CHILD_TX_HASH,
        chainId: 42161,
      })
    )
  })

  test('marks the page executed as well as redeemed on success', async () => {
    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(pagesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: {
          Status: { select: { name: 'Executed' } },
          Decision: { select: { name: 'Redeemed' } },
          'Bot Redemption Status': { select: { name: 'Bot Success' } },
        },
      })
    )
  })

  test('writes back the live status when Notion is stale', async () => {
    vi.mocked(getLiveRetryableStatus).mockResolvedValue('CREATION_FAILED')

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(pagesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: { Status: { select: { name: 'CREATION_FAILED' } } },
      })
    )
  })

  test('does not redeem a ticket that is not sitting on the child chain', async () => {
    vi.mocked(getLiveRetryableStatus).mockResolvedValue('CREATION_FAILED')

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).not.toHaveBeenCalled()
  })

  test('records a ticket redeemed elsewhere as executed without redeeming', async () => {
    vi.mocked(getLiveRetryableStatus).mockResolvedValue('Executed')

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).not.toHaveBeenCalled()
    expect(pagesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: {
          Status: { select: { name: 'Executed' } },
          Decision: { select: { name: 'Redeemed' } },
        },
      })
    )
  })

  test('retires the decision of a row already marked executed', async () => {
    const page = buildPage(48)
    page.properties.Status = { select: { name: 'Executed' } }
    databasesQuery.mockResolvedValue({ results: [page] })
    vi.mocked(getLiveRetryableStatus).mockResolvedValue('Executed')

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(pagesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: { Decision: { select: { name: 'Redeemed' } } },
      })
    )
  })

  test('queries executed rows that are still marked for redemption', async () => {
    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(databasesQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: {
          or: [
            {
              and: [
                { property: 'Decision', select: { equals: 'Triage' } },
                {
                  property: 'Status',
                  select: { does_not_equal: 'Executed' },
                },
              ],
            },
            {
              property: 'Decision',
              select: { equals: 'Should Redeem' },
            },
          ],
        },
      })
    )
  })

  test('marks the page as failed when the redeem throws', async () => {
    vi.mocked(redeemRetryable).mockRejectedValueOnce(new Error('boom'))

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(pagesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: {
          'Bot Redemption Status': { select: { name: 'Bot Failed' } },
        },
      })
    )
  })

  test('forwards the config path it was run with', async () => {
    await alertUntriagedNotionRetryables(CHAINS, true, '../../rh.config.json')

    expect(redeemRetryable).toHaveBeenCalledWith(
      PARENT_TX_HASH,
      expect.objectContaining({ configPath: '../../rh.config.json' })
    )
  })

  test('skips rather than redeeming a sibling ticket when ChildTx is unusable', async () => {
    databasesQuery.mockResolvedValue({ results: [buildPage(48, '(unknown)')] })

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).not.toHaveBeenCalled()
    expect(pagesUpdate).not.toHaveBeenCalled()
  })

  test('does not redeem when the live status could not be read', async () => {
    vi.mocked(getLiveRetryableStatus).mockRejectedValue(new Error('rpc down'))

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).not.toHaveBeenCalled()
    expect(pagesUpdate).not.toHaveBeenCalled()
  })

  test('does not redeem when the ticket cannot be located', async () => {
    vi.mocked(getLiveRetryableStatus).mockResolvedValue(null)

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).not.toHaveBeenCalled()
  })

  test('does not redeem when auto-redeem is disabled', async () => {
    await alertUntriagedNotionRetryables(CHAINS, false)

    expect(redeemRetryable).not.toHaveBeenCalled()
    expect(pagesUpdate).not.toHaveBeenCalled()
  })
})
