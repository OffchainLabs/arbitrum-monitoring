import { describe, expect, test } from 'vitest'
import {
  formatPrefix,
  formatCreatedAt,
  formatExpiration,
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
