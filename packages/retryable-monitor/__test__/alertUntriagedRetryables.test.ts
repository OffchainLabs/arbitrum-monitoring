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
import { postSlackMessage } from '../handlers/slack/postSlackMessage'

const PARENT_TX_HASH =
  '0xe60d848b8fae81b103135825c30c2ca169170100cad7fbdf3e73d062e3fc90d6'
const CHILD_TX_HASH =
  '0xa0922360dad7e9d29b6aecd543f323cb9524e30edd2d1a45d758fcd8fa786a9e'

const CHAINS = [{ chainId: 42161 }] as any

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const buildPage = (
  hoursUntilExpiry: number,
  childTx = `https://robinhoodchain.blockscout.com/tx/${CHILD_TX_HASH}`,
  // tickets live seven days, so a row's age follows from its remaining time
  // unless a test overrides it
  daysSinceCreation = 7 - hoursUntilExpiry / 24
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
    CreatedAt: {
      date: {
        start: new Date(Date.now() - daysSinceCreation * DAY_MS).toISOString(),
      },
    },
    timeoutTimestamp: {
      date: {
        start: new Date(Date.now() + hoursUntilExpiry * HOUR_MS).toISOString(),
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

const REDEEM_DECISIONS = ['Should Redeem', 'Force Redeem']

// the sweep runs one query for rows the bot may redeem and another for rows
// awaiting triage, so the mock has to answer each with only its own rows
const setRows = (...pages: any[]) => {
  databasesQuery.mockImplementation(async (args: any) => {
    const wantsRedeemable = JSON.stringify(args.filter).includes('Force Redeem')
    return {
      results: pages.filter(page => {
        const decision = page.properties?.Decision?.select?.name
        return wantsRedeemable
          ? REDEEM_DECISIONS.includes(decision)
          : decision === 'Triage'
      }),
    }
  })
}

describe('alertUntriagedNotionRetryables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pagesUpdate.mockReset().mockResolvedValue(undefined)
    setRows(buildPage(48))
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
    setRows(page)
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
          and: [
            { or: [{ property: 'ChainID', number: { equals: 42161 } }] },
            {
              or: [
                { property: 'Decision', select: { equals: 'Should Redeem' } },
                { property: 'Decision', select: { equals: 'Force Redeem' } },
              ],
            },
          ],
        },
      })
    )
  })

  test('asks Notion for triage rows separately from redeemable ones', async () => {
    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(databasesQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: {
          and: [
            { or: [{ property: 'ChainID', number: { equals: 42161 } }] },
            { property: 'Decision', select: { equals: 'Triage' } },
            { property: 'Status', select: { does_not_equal: 'Executed' } },
          ],
        },
      })
    )
  })

  test('scopes both queries to the chains the run was given', async () => {
    await alertUntriagedNotionRetryables(
      [{ chainId: 42161 }, { chainId: 4663 }] as any,
      true
    )

    for (const [args] of databasesQuery.mock.calls) {
      expect(args.filter.and[0]).toEqual({
        or: [
          { property: 'ChainID', number: { equals: 42161 } },
          { property: 'ChainID', number: { equals: 4663 } },
        ],
      })
    }
    expect(databasesQuery).toHaveBeenCalledTimes(2)
  })

  test('leaves the filter unscoped when no chains were given', async () => {
    await alertUntriagedNotionRetryables([], true)

    for (const [args] of databasesQuery.mock.calls) {
      expect(JSON.stringify(args.filter)).not.toContain('ChainID')
    }
  })

  test('reads every page returned by each scoped query', async () => {
    const first = buildPage(48)
    first.id = 'page-first'
    const second = buildPage(48)
    second.id = 'page-second'

    databasesQuery.mockImplementation(async (args: any) => {
      const redeemQuery = JSON.stringify(args.filter).includes('Force Redeem')
      if (!redeemQuery) return { results: [], has_more: false }
      if (!args.start_cursor) {
        return {
          results: [first],
          has_more: true,
          next_cursor: 'next-page',
        }
      }
      return { results: [second], has_more: false, next_cursor: null }
    })

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).toHaveBeenCalledTimes(2)
    expect(databasesQuery).toHaveBeenCalledWith(
      expect.objectContaining({ start_cursor: 'next-page' })
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
    setRows(buildPage(48, '(unknown)'))

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

  test('does not alert a nearing-expiry row whose ticket was never created', async () => {
    setRows(buildPage(6))
    vi.mocked(getLiveRetryableStatus).mockResolvedValue('CREATION_FAILED')

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(postSlackMessage).not.toHaveBeenCalled()
    expect(pagesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: { Status: { select: { name: 'CREATION_FAILED' } } },
      })
    )
  })

  test('alerts a nearing-expiry row when the run cannot redeem it itself', async () => {
    setRows(buildPage(6))

    await alertUntriagedNotionRetryables(CHAINS, false)

    expect(postSlackMessage).toHaveBeenCalledWith({
      message: expect.stringContaining('nearing expiry'),
    })
    expect(redeemRetryable).not.toHaveBeenCalled()
  })

  test('waits until day 4 before redeeming a Should Redeem row', async () => {
    setRows(buildPage(96, undefined, 3))

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).not.toHaveBeenCalled()
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  test('redeems a Should Redeem row once it reaches day 4', async () => {
    setRows(buildPage(72, undefined, 4))

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).toHaveBeenCalled()
  })

  test('redeems a live kept-alive ticket past its stored timeout', async () => {
    setRows(buildPage(-24, undefined, 8))

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(getLiveRetryableStatus).toHaveBeenCalled()
    expect(redeemRetryable).toHaveBeenCalled()
  })

  test('redeems a Force Redeem row before day 4', async () => {
    const page = buildPage(144, undefined, 1)
    page.properties.Decision = { select: { name: 'Force Redeem' } }
    setRows(page)

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).toHaveBeenCalled()
  })

  test('falls back to the timeout when a legacy row has no CreatedAt', async () => {
    const page = buildPage(72)
    delete (page.properties as any).CreatedAt
    setRows(page)

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).toHaveBeenCalled()
  })

  test('pings Slack and flags the row when the redeem fails', async () => {
    vi.mocked(redeemRetryable).mockRejectedValueOnce(new Error('boom'))

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(pagesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: {
          'Bot Redemption Status': { select: { name: 'Bot Failed' } },
        },
      })
    )
    expect(postSlackMessage).toHaveBeenCalledWith({
      message: expect.stringContaining('Auto-redemption FAILED'),
    })
  })

  test('posts one summary of the redemptions a run completed', async () => {
    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(postSlackMessage).toHaveBeenCalledWith({
      message: expect.stringContaining('1 retryable auto-redeemed'),
    })
  })

  test('does not report a failure when only the success write fails', async () => {
    pagesUpdate.mockRejectedValue(new Error('notion 500'))

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).toHaveBeenCalled()
    expect(pagesUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        properties: {
          'Bot Redemption Status': { select: { name: 'Bot Failed' } },
        },
      })
    )
    expect(postSlackMessage).not.toHaveBeenCalledWith({
      message: expect.stringContaining('FAILED'),
    })
  })

  test('still counts a redeemed ticket the success write could not record', async () => {
    pagesUpdate.mockRejectedValue(new Error('notion 500'))

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(postSlackMessage).toHaveBeenCalledWith({
      message: expect.stringContaining('1 retryable auto-redeemed'),
    })
  })

  test('keeps sweeping the rows behind one that could not be written', async () => {
    const stale = buildPage(48)
    stale.id = 'page-stale'
    const healthy = buildPage(48)
    healthy.id = 'page-healthy'
    setRows(stale, healthy)
    pagesUpdate.mockRejectedValueOnce(new Error('notion 429'))

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(redeemRetryable).toHaveBeenCalledTimes(2)
    expect(pagesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ page_id: 'page-healthy' })
    )
    await expect(pagesUpdate.mock.results[1].value).resolves.toBeUndefined()
  })

  test('posts no summary when a run redeemed nothing', async () => {
    vi.mocked(getLiveRetryableStatus).mockResolvedValue('CREATION_FAILED')

    await alertUntriagedNotionRetryables(CHAINS, true)

    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  test('reconciles a row past its notion timeout instead of skipping it', async () => {
    setRows(buildPage(-5))
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

  test('does not redeem when auto-redeem is disabled', async () => {
    await alertUntriagedNotionRetryables(CHAINS, false)

    expect(redeemRetryable).not.toHaveBeenCalled()
    expect(pagesUpdate).not.toHaveBeenCalled()
  })
})
