import { describe, expect, test, vi, beforeEach } from 'vitest'
import { ChildNetwork } from 'utils'
import {
  ChildChainTicketReport,
  OnFailedRetryableFoundParams,
  ParentChainTicketReport,
} from '../core/types'

vi.mock('../handlers/zeroValueTicketDigest', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../handlers/zeroValueTicketDigest')
  >()),
  addTicketToZeroValueDigest: vi.fn(),
}))

vi.mock('../handlers/slack/postSlackMessage', () => ({
  postSlackMessage: vi.fn(),
}))

vi.mock('../handlers/fundedTicketDigest', async importOriginal => ({
  ...(await importOriginal<typeof import('../handlers/fundedTicketDigest')>()),
  addTicketToFundedDigest: vi.fn(),
}))

import { reportFailedRetryables } from '../handlers/reportFailedRetryables'
import { addTicketToZeroValueDigest } from '../handlers/zeroValueTicketDigest'
import { addTicketToFundedDigest } from '../handlers/fundedTicketDigest'

const nowInSeconds = Math.floor(Date.now() / 1000)
const DAY_IN_SECONDS = 24 * 60 * 60

const childChain = {
  name: 'Test Chain',
  chainId: 12345,
  explorerUrl: 'https://child.explorer/',
  parentExplorerUrl: 'https://parent.explorer/',
} as ChildNetwork

const buildTicket = (
  childOverrides: Partial<ChildChainTicketReport> = {}
): OnFailedRetryableFoundParams => ({
  parentChainRetryableReport: {
    id: '0xparenttx',
    transactionHash: '0xparenttx',
    sender: '0xsender',
    retryableTicketID: '0xticket',
  } as ParentChainTicketReport,
  childChainRetryableReport: {
    id: '0xticket',
    createdAtTimestamp: String(nowInSeconds - DAY_IN_SECONDS),
    createdAtBlockNumber: 1,
    timeoutTimestamp: String(nowInSeconds + 6 * DAY_IN_SECONDS),
    deposit: '0',
    status: 'FUNDS_DEPOSITED_ON_CHILD',
    retryTo: '0xdest',
    retryData: '0x',
    gasFeeCap: 0,
    gasLimit: 0,
    ...childOverrides,
  },
  tokenDepositData: undefined,
  childChain,
})

describe('reportFailedRetryables muting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('routes funded tickets to the funded buffer, not the zero-value digest', async () => {
    await reportFailedRetryables(
      buildTicket({
        deposit: '100000000000000000',
      })
    )

    expect(addTicketToFundedDigest).toHaveBeenCalledOnce()
    expect(addTicketToZeroValueDigest).not.toHaveBeenCalled()
  })

  test('muting also applies to funded tickets', async () => {
    await reportFailedRetryables(
      buildTicket({
        deposit: '100000000000000000',
        status: 'EXPIRED',
        createdAtTimestamp: String(nowInSeconds - 10 * DAY_IN_SECONDS),
        timeoutTimestamp: String(nowInSeconds - 3 * DAY_IN_SECONDS),
      })
    )

    expect(addTicketToFundedDigest).not.toHaveBeenCalled()
  })

  test('mutes CREATION_FAILED tickets older than 2 days', async () => {
    await reportFailedRetryables(
      buildTicket({
        status: 'CREATION_FAILED',
        createdAtTimestamp: String(nowInSeconds - 3 * DAY_IN_SECONDS),
      })
    )

    expect(addTicketToZeroValueDigest).not.toHaveBeenCalled()
  })

  test('still reports fresh CREATION_FAILED tickets', async () => {
    await reportFailedRetryables(
      buildTicket({
        status: 'CREATION_FAILED',
        createdAtTimestamp: String(nowInSeconds - 1 * DAY_IN_SECONDS),
      })
    )

    expect(addTicketToZeroValueDigest).toHaveBeenCalledOnce()
  })

  test('always reports FUNDS_DEPOSITED_ON_CHILD tickets, even ones older than the muting window', async () => {
    await reportFailedRetryables(
      buildTicket({
        status: 'FUNDS_DEPOSITED_ON_CHILD',
        createdAtTimestamp: String(nowInSeconds - 6 * DAY_IN_SECONDS),
        timeoutTimestamp: String(nowInSeconds + 1 * DAY_IN_SECONDS),
      })
    )

    expect(addTicketToZeroValueDigest).toHaveBeenCalledOnce()
  })

  test('mutes EXPIRED tickets more than 2 days past their timeout', async () => {
    await reportFailedRetryables(
      buildTicket({
        status: 'EXPIRED',
        createdAtTimestamp: String(nowInSeconds - 10 * DAY_IN_SECONDS),
        timeoutTimestamp: String(nowInSeconds - 3 * DAY_IN_SECONDS),
      })
    )

    expect(addTicketToZeroValueDigest).not.toHaveBeenCalled()
  })

  test('still reports freshly EXPIRED tickets', async () => {
    await reportFailedRetryables(
      buildTicket({
        status: 'EXPIRED',
        createdAtTimestamp: String(nowInSeconds - 8 * DAY_IN_SECONDS),
        timeoutTimestamp: String(nowInSeconds - 1 * DAY_IN_SECONDS),
      })
    )

    expect(addTicketToZeroValueDigest).toHaveBeenCalledOnce()
  })
})
