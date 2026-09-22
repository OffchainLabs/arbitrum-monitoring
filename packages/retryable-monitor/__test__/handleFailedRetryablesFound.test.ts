import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../handlers/notion/syncRetryableToNotion', () => ({
  syncRetryableToNotion: vi.fn(),
}))

vi.mock('../handlers/reportFailedRetryables', () => ({
  reportFailedRetryables: vi.fn(),
}))

vi.mock('../handlers/runReport', () => ({
  recordReportedRetryable: vi.fn(),
}))

vi.mock('../handlers/notion/fetchedNotionRetryablesUtils', () => ({
  addToFetchedNotionRetryables: vi.fn(),
}))

vi.mock('../handlers/slack/slackMessageFormattingUtils', () => ({
  formatL2Callvalue: vi.fn().mockResolvedValue('0.01 ETH'),
  getGasInfo: vi
    .fn()
    .mockResolvedValue({ l2GasPrice: 1, l2GasPriceAtCreation: 1 }),
  getTokenPrice: vi.fn().mockResolvedValue(1),
}))

vi.mock('ethers', async importOriginal => {
  const actual = await importOriginal<typeof import('ethers')>()
  return {
    ...actual,
    providers: { JsonRpcProvider: vi.fn() },
  }
})

import { handleFailedRetryablesFound } from '../handlers/handleFailedRetryablesFound'
import { syncRetryableToNotion } from '../handlers/notion/syncRetryableToNotion'
import { reportFailedRetryables } from '../handlers/reportFailedRetryables'

let ticketCounter = 0

const buildTicket = () => {
  ticketCounter += 1
  return {
    childChain: {
      chainId: 42161,
      name: 'Arbitrum One',
      orbitRpcUrl: 'https://rpc',
      parentRpcUrl: 'https://parent',
      explorerUrl: 'https://arbiscan.io',
      parentExplorerUrl: 'https://etherscan.io',
      autoRedeem: true,
    },
    childChainRetryableReport: {
      id: `0x${String(ticketCounter).padStart(64, '0')}`,
      createdAtBlockNumber: 1,
      createdAtTimestamp: '1700000000',
      timeoutTimestamp: '1700600000',
      status: 'FUNDS_DEPOSITED_ON_CHILD',
      gasFeeCap: '1000000000',
      feeRefundAddress: '0xfee',
      beneficiary: '0xben',
      retryTo: '0xto',
      retryData: '0x',
    },
    parentChainRetryableReport: { transactionHash: '0xparent' },
  } as any
}

describe('handleFailedRetryablesFound', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(syncRetryableToNotion).mockResolvedValue({
      id: 'page-1',
      status: 'FUNDS_DEPOSITED_ON_CHILD',
      isNew: true,
    })
  })

  test('logs a triage decision when the run cannot redeem', async () => {
    await handleFailedRetryablesFound(buildTicket(), true, false)

    expect(syncRetryableToNotion).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'Triage' })
    )
  })

  test('logs a redeemable decision when the run can redeem', async () => {
    await handleFailedRetryablesFound(buildTicket(), true, true)

    expect(syncRetryableToNotion).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'Should Redeem' })
    )
  })

  test('requires the chain to opt into auto-redemption', async () => {
    const ticket = buildTicket()
    ticket.childChain.autoRedeem = false

    await handleFailedRetryablesFound(ticket, true, true)

    expect(syncRetryableToNotion).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'Triage' })
    )
    expect(reportFailedRetryables).not.toHaveBeenCalled()
  })

  test('alerts once when an auto-redeem row first appears', async () => {
    await handleFailedRetryablesFound(buildTicket(), true, true)

    expect(reportFailedRetryables).toHaveBeenCalledTimes(1)
  })

  test('alerts when Notion could not preserve an auto-redeem row', async () => {
    vi.mocked(syncRetryableToNotion).mockResolvedValue(undefined)

    await handleFailedRetryablesFound(buildTicket(), true, true)

    expect(reportFailedRetryables).toHaveBeenCalledTimes(1)
  })

  test('stays quiet on later runs that re-find the same ticket', async () => {
    vi.mocked(syncRetryableToNotion).mockResolvedValue({
      id: 'page-1',
      status: 'FUNDS_DEPOSITED_ON_CHILD',
      isNew: false,
    })

    await handleFailedRetryablesFound(buildTicket(), true, true)

    expect(reportFailedRetryables).not.toHaveBeenCalled()
  })

  test('leaves triage runs on the recurring sweep alert', async () => {
    await handleFailedRetryablesFound(buildTicket(), true, false)

    expect(reportFailedRetryables).not.toHaveBeenCalled()
  })
})
