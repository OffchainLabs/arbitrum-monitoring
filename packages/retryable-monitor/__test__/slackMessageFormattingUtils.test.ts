import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('axios', () => ({ default: { get: vi.fn() } }))

import axios from 'axios'
import {
  formatPrefix,
  formatCreatedAt,
  formatExpiration,
  formatTokenAmount,
  formatTokenDepositData,
} from '../handlers/slack/slackMessageFormattingUtils'
import { ChildChainTicketReport } from '../core/types'

const nowInSeconds = Math.floor(Date.now() / 1000)

const buildTicket = (
  overrides: Partial<ChildChainTicketReport>
): ChildChainTicketReport => ({
  id: '0xticket',
  createdAtTimestamp: String(nowInSeconds - 24 * 60 * 60),
  createdAtBlockNumber: 1,
  timeoutTimestamp: String(nowInSeconds + 6 * 24 * 60 * 60),
  deposit: '0',
  status: 'FUNDS_DEPOSITED_ON_CHILD',
  retryTo: '0xdest',
  retryData: '0x',
  gasFeeCap: 0,
  gasLimit: 0,
  ...overrides,
})

describe('formatPrefix', () => {
  test('unredeemed ticket with a failed auto-redeem attempt', () => {
    const prefix = formatPrefix(
      buildTicket({ retryTxHash: '0xretry' }),
      'Test Chain'
    )
    expect(prefix).toContain('Redeem failed for ticket')
  })

  test('unredeemed ticket without any auto-redeem attempt', () => {
    const prefix = formatPrefix(buildTicket({}), 'Test Chain')
    expect(prefix).toContain('Ticket created but not redeemed')
  })

  test('creation failed maps to its own prefix instead of unrecognized state', () => {
    const prefix = formatPrefix(
      buildTicket({ status: 'CREATION_FAILED' }),
      'Test Chain'
    )
    expect(prefix).toContain('Retryable ticket creation failed')
    expect(prefix).not.toContain('unrecognized state')
  })

  test('escalates unredeemed tickets expiring in less than 48h', () => {
    const prefix = formatPrefix(
      buildTicket({ timeoutTimestamp: String(nowInSeconds + 60 * 60) }),
      'Test Chain'
    )
    expect(prefix).toContain('🆘')
  })

  test('does not escalate tickets with more than 48h left', () => {
    const prefix = formatPrefix(buildTicket({}), 'Test Chain')
    expect(prefix).not.toContain('🆘')
  })
})

describe('formatCreatedAt', () => {
  test('renders a sane date from a timestamp in seconds', () => {
    // 13 Jul 2026 13:55:53 UTC — regression test for the ms-vs-s unit bug
    // that rendered creation dates in the year 58501
    const msg = formatCreatedAt(buildTicket({ createdAtTimestamp: '1783950953' }))
    expect(msg).toContain('13 Jul 2026')
  })
})

describe('formatExpiration', () => {
  test('appends time-left countdown for unredeemed tickets', () => {
    const msg = formatExpiration(buildTicket({}))
    expect(msg).toContain('Expires at:')
    expect(msg).toContain('from now')
  })

  test('uses "Expired at" wording without countdown for expired tickets', () => {
    const msg = formatExpiration(
      buildTicket({
        status: 'EXPIRED',
        timeoutTimestamp: String(nowInSeconds - 60 * 60),
      })
    )
    expect(msg).toContain('Expired at:')
    expect(msg).not.toContain('from now')
  })
})

describe('formatTokenAmount', () => {
  // the price cache is module state, so every test uses its own address
  let addressCounter = 0
  const nextAddress = () =>
    `0x${String((addressCounter += 1)).padStart(40, '0')}`

  const priced = (addr: string, usd: number) => ({
    data: { [addr.toLowerCase()]: { usd } },
  })

  beforeEach(() => {
    vi.mocked(axios.get).mockReset()
  })

  test('omits the USD figure for a token CoinGecko does not list', async () => {
    const address = nextAddress()
    vi.mocked(axios.get).mockResolvedValue({ data: {} })

    const msg = await formatTokenAmount({
      amountRaw: '3202684130256773314397146',
      decimals: 18,
      symbol: 'ETHERER',
      address,
    })

    // regression: an unlisted token used to fall back to $1 per token and
    // report a $50 memecoin deposit as $3,202,684.13
    expect(msg).not.toContain('$')
    expect(msg).toBe(`3202684.130256773314397146 ETHERER (${address})`)
  })

  test('appends the USD figure for a listed token', async () => {
    const address = nextAddress()
    vi.mocked(axios.get).mockResolvedValue(priced(address, 2750.24))

    const msg = await formatTokenAmount({
      amountRaw: '2000000000000000000',
      decimals: 18,
      symbol: 'WETH',
      address,
    })

    expect(msg).toBe(`2.0 WETH ($5500.48) (${address})`)
  })

  test('keeps sub-cent unit prices accurate', async () => {
    const address = nextAddress()
    vi.mocked(axios.get).mockResolvedValue(priced(address, 0.0000157))

    const msg = await formatTokenAmount({
      amountRaw: '3202684130256773314397146',
      decimals: 18,
      symbol: 'ETHERER',
      address,
    })

    // regression: scaling the price by 1e6 and flooring collapsed any unit
    // price below $0.000001 to zero
    expect(msg).toContain('($50.28)')
  })

  test('handles amounts too large for the previous BigNumber conversion', async () => {
    const address = nextAddress()
    vi.mocked(axios.get).mockResolvedValue(priced(address, 1.5))

    const msg = await formatTokenAmount({
      amountRaw: '1000000000000000000000000000',
      decimals: 18,
      symbol: 'HUGE',
      address,
    })

    expect(msg).toContain('($1500000000.00)')
  })

  test('caches an unlisted token instead of re-querying per ticket', async () => {
    const address = nextAddress()
    vi.mocked(axios.get).mockResolvedValue({ data: {} })

    const args = { amountRaw: '1', decimals: 0, symbol: 'X', address }
    await formatTokenAmount(args)
    await formatTokenAmount(args)

    expect(axios.get).toHaveBeenCalledTimes(1)
  })

  test('treats a null CoinGecko price as unpriced', async () => {
    const address = nextAddress()
    vi.mocked(axios.get).mockResolvedValue({
      data: { [address.toLowerCase()]: { usd: null } },
    })

    const msg = await formatTokenAmount({
      amountRaw: '1',
      decimals: 0,
      symbol: 'X',
      address,
    })

    expect(msg).not.toContain('$')
  })

  test('drops the USD figure when the price lookup fails, and retries it', async () => {
    const address = nextAddress()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('429 rate limited'))

    const args = { amountRaw: '1', decimals: 0, symbol: 'X', address }
    expect(await formatTokenAmount(args)).not.toContain('$')

    // a failed lookup is not an answer, so it must not be cached as unpriced
    vi.mocked(axios.get).mockResolvedValue(priced(address, 3))
    expect(await formatTokenAmount(args)).toContain('($3.00)')
  })
})

describe('formatTokenDepositData', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset()
    vi.mocked(axios.get).mockResolvedValue({ data: {} })
  })

  test('renders a dash when there is no deposit', async () => {
    expect(await formatTokenDepositData(undefined)).toContain('-')
    expect(axios.get).not.toHaveBeenCalled()
  })

  test('renders a dash when the deposit carries no amount', async () => {
    const deposit = {
      tokenAmount: '',
      l1Token: { id: '0xtoken', symbol: 'TKN', decimals: 18 },
    } as any

    expect(await formatTokenDepositData(deposit)).toContain('-')
    expect(axios.get).not.toHaveBeenCalled()
  })
})
