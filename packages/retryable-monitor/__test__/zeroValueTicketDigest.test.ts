import { describe, expect, test } from 'vitest'
import { ChildNetwork } from 'utils'
import {
  buildZeroValueDigestMessage,
  isZeroValueTicket,
} from '../handlers/zeroValueTicketDigest'
import { ticketAlreadyHandled } from '../handlers/handleFailedRetryablesFound'
import {
  ChildChainTicketReport,
  OnFailedRetryableFoundParams,
  ParentChainTicketReport,
  TokenDepositData,
} from '../core/types'

const nowInSeconds = Math.floor(Date.now() / 1000)

const childChain = {
  name: 'Test Chain',
  chainId: 12345,
  explorerUrl: 'https://child.explorer/',
  parentExplorerUrl: 'https://parent.explorer/',
} as ChildNetwork

const buildChildReport = (
  overrides: Partial<ChildChainTicketReport> = {}
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

const buildParentReport = (
  overrides: Partial<ParentChainTicketReport> = {}
): ParentChainTicketReport => ({
  id: '0xparenttx',
  transactionHash: '0xparenttx',
  sender: '0xsender',
  retryableTicketID: '0xticket',
  ...overrides,
})

const buildTokenDeposit = (tokenAmount?: string): TokenDepositData => ({
  l2TicketId: '0xticket',
  tokenAmount,
  sender: '0xsender',
  l1Token: { symbol: 'TST', decimals: 18, id: '0xtoken' },
})

const buildTicket = ({
  childOverrides,
  parentOverrides,
  tokenDepositData,
}: {
  childOverrides?: Partial<ChildChainTicketReport>
  parentOverrides?: Partial<ParentChainTicketReport>
  tokenDepositData?: TokenDepositData
} = {}): OnFailedRetryableFoundParams => ({
  parentChainRetryableReport: buildParentReport(parentOverrides),
  childChainRetryableReport: buildChildReport(childOverrides),
  tokenDepositData,
  childChain,
})

describe('isZeroValueTicket', () => {
  test('zero callvalue and no token deposit is zero-value', () => {
    expect(isZeroValueTicket(buildTicket())).toBe(true)
  })

  test('non-zero callvalue is not zero-value', () => {
    expect(
      isZeroValueTicket(buildTicket({ childOverrides: { deposit: '1' } }))
    ).toBe(false)
  })

  test('non-zero token deposit is not zero-value', () => {
    expect(
      isZeroValueTicket(
        buildTicket({ tokenDepositData: buildTokenDeposit('1000') })
      )
    ).toBe(false)
  })

  test('token deposit with zero amount is still zero-value', () => {
    expect(
      isZeroValueTicket(buildTicket({ tokenDepositData: buildTokenDeposit('0') }))
    ).toBe(true)
  })

  test('token deposit with unresolved amount is not zero-value', () => {
    expect(
      isZeroValueTicket(
        buildTicket({ tokenDepositData: buildTokenDeposit(undefined) })
      )
    ).toBe(false)
  })

  test('unparseable amounts are treated as non-zero to avoid silencing real deposits', () => {
    expect(
      isZeroValueTicket(
        buildTicket({ childOverrides: { deposit: 'not-a-number' } })
      )
    ).toBe(false)
  })
})

describe('buildZeroValueDigestMessage', () => {
  test('aggregates counts by status and sender into a single message', () => {
    const tickets = [
      buildTicket({ childOverrides: { id: '0xaaa' } }),
      buildTicket({ childOverrides: { id: '0xbbb' } }),
      buildTicket({
        childOverrides: { id: '0xccc', status: 'CREATION_FAILED' },
        parentOverrides: { sender: '0xothersender' },
      }),
    ]

    const message = buildZeroValueDigestMessage(childChain, tickets)

    expect(message).toContain('[Test Chain] 3 zero-value retryables')
    expect(message).toContain('created but not redeemed: 2')
    expect(message).toContain('creation failed: 1')
    expect(message).toContain('0xsender: 2')
    expect(message).toContain('0xothersender: 1')
    expect(message).toContain('https://child.explorer/tx/0xaaa')
  })

  test('reports the earliest expiry across tickets', () => {
    const soonTimeout = String(nowInSeconds + 60 * 60)
    const tickets = [
      buildTicket(),
      buildTicket({ childOverrides: { timeoutTimestamp: soonTimeout } }),
    ]

    const message = buildZeroValueDigestMessage(childChain, tickets)

    expect(message).toContain(
      `*Earliest expiry:* ${new Date(+soonTimeout * 1000).toUTCString()}`
    )
  })

  test('CREATION_FAILED tickets show no expiry (theirs is synthetic)', () => {
    const tickets = [
      buildTicket({
        childOverrides: { id: '0xfailed', status: 'CREATION_FAILED' },
      }),
    ]

    const message = buildZeroValueDigestMessage(childChain, tickets)

    expect(message).toContain('0xfailed> — never created, no expiry')
    expect(message).not.toContain('expires')
    expect(message).not.toContain('*Earliest expiry:*')
  })

  test('earliest expiry ignores the synthetic timeout of CREATION_FAILED tickets', () => {
    const realTimeout = String(nowInSeconds + 60 * 60)
    const syntheticSoonerTimeout = String(nowInSeconds + 60)
    const tickets = [
      buildTicket({ childOverrides: { timeoutTimestamp: realTimeout } }),
      buildTicket({
        childOverrides: {
          status: 'CREATION_FAILED',
          timeoutTimestamp: syntheticSoonerTimeout,
        },
      }),
    ]

    const message = buildZeroValueDigestMessage(childChain, tickets)

    expect(message).toContain(
      `*Earliest expiry:* ${new Date(+realTimeout * 1000).toUTCString()}`
    )
  })

  test('caps the listed senders and reports the overflow count', () => {
    const tickets = Array.from({ length: 7 }, (_, i) =>
      buildTicket({
        childOverrides: { id: `0xticket${i}` },
        parentOverrides: { sender: `0xsender${i}` },
      })
    )

    const message = buildZeroValueDigestMessage(childChain, tickets)

    expect(message).toContain('0xsender4: 1')
    expect(message).not.toContain('0xsender5')
    expect(message).toContain('…and 2 more senders')
  })

  test('caps the listed tickets and reports the overflow count', () => {
    const tickets = Array.from({ length: 25 }, (_, i) =>
      buildTicket({ childOverrides: { id: `0xticket${i}` } })
    )

    const message = buildZeroValueDigestMessage(childChain, tickets)

    expect(message).toContain('25 zero-value retryables')
    expect(message).toContain('0xticket19')
    expect(message).not.toContain('0xticket20>')
    expect(message).toContain('…and 5 more')
  })
})

describe('ticketAlreadyHandled', () => {
  test('same ticket surfacing twice is only handled once (chunk retries)', () => {
    const ticket = buildTicket({ childOverrides: { id: '0xdedupe' } })

    expect(ticketAlreadyHandled(ticket)).toBe(false)
    expect(ticketAlreadyHandled(ticket)).toBe(true)
  })

  test('same ticket id on different chains is handled separately', () => {
    const ticket = buildTicket({ childOverrides: { id: '0xcrosschain' } })
    const otherChainTicket = {
      ...ticket,
      childChain: { ...childChain, chainId: 99999 },
    }

    expect(ticketAlreadyHandled(ticket)).toBe(false)
    expect(ticketAlreadyHandled(otherChainTicket)).toBe(false)
  })
})
