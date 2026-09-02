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

vi.mock('../core/redeemRetryable', () => ({ redeemRetryable: vi.fn() }))

vi.mock('../handlers/slack/postSlackMessage', () => ({
  postSlackMessage: vi.fn(),
}))

import {
  alertUntriagedNotionRetryables,
  extractTxHash,
} from '../handlers/notion/alertUntriagedRetraybles'
import { redeemRetryable } from '../core/redeemRetryable'

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
    Status: { select: { name: 'Pending' } },
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
  })

  test('redeems with the raw hash, not the explorer URL', async () => {
    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).toHaveBeenCalledWith(
      PARENT_TX_HASH,
      expect.objectContaining({ retryableCreationId: CHILD_TX_HASH })
    )
    expect(pagesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: {
          'Bot Redemption Status': { select: { name: 'Bot Success' } },
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

  test('does not redeem when auto-redeem is disabled', async () => {
    await alertUntriagedNotionRetryables(CHAINS, false)

    expect(redeemRetryable).not.toHaveBeenCalled()
    expect(pagesUpdate).not.toHaveBeenCalled()
  })
})
