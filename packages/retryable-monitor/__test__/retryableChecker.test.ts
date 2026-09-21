import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const {
  getMessageDeliveredEventData,
  getDepositInitiatedLogs,
  getParentToChildMessages,
  getParentChainRetryableReport,
  getChildChainRetryableReport,
  getTokenDepositData,
} = vi.hoisted(() => ({
  getMessageDeliveredEventData: vi.fn(),
  getDepositInitiatedLogs: vi.fn(),
  getParentToChildMessages: vi.fn(),
  getParentChainRetryableReport: vi.fn(),
  getChildChainRetryableReport: vi.fn(),
  getTokenDepositData: vi.fn(),
}))

vi.mock('@arbitrum/sdk', async importOriginal => ({
  ...(await importOriginal<typeof import('@arbitrum/sdk')>()),
  ParentTransactionReceipt: vi.fn(() => ({ getParentToChildMessages })),
}))

vi.mock('../core/depositEventFetcher', () => ({
  getMessageDeliveredEventData,
  getDepositInitiatedLogs,
}))

vi.mock('../core/reportGenerator', () => ({
  getParentChainRetryableReport,
  getChildChainRetryableReport,
}))

vi.mock('../core/tokenDataFetcher', () => ({ getTokenDepositData }))

import { ParentToChildMessageStatus } from '@arbitrum/sdk'
import { checkRetryables } from '../core/retryableChecker'

const status = vi.fn()
const getParentTransactionReceipt = vi.fn()
const getTransaction = vi.fn()
const getChildTransactionReceipt = vi.fn()
const onFailedRetryableFound = vi.fn()
const retryableMessage = { retryableCreationId: '0xticket', status }
const childChain = {
  chainId: 42161,
  name: 'Arbitrum One',
  explorerUrl: 'https://arbiscan.io/',
  parentExplorerUrl: 'https://etherscan.io/',
  tokenBridge: {
    parentErc20Gateway: '0x1',
    parentCustomGateway: '0x2',
    parentWethGateway: '0x3',
  },
} as any

describe('checkRetryables RPC retries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb()
      return 0 as unknown as NodeJS.Timeout
    }) as typeof setTimeout)
    status
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValue(ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD)
    getParentTransactionReceipt
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValue({ logs: [] })
    getTransaction
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValue({ data: '0x' })
    getChildTransactionReceipt
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValue({ blockNumber: 1 })
    getMessageDeliveredEventData.mockResolvedValue([
      { transactionHash: '0xparent' },
    ])
    getDepositInitiatedLogs.mockResolvedValue([])
    getParentToChildMessages
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValue([retryableMessage])
    getParentChainRetryableReport.mockReturnValue({ id: 'parent-report' })
    getChildChainRetryableReport.mockResolvedValue({ id: 'child-report' })
    getTokenDepositData.mockResolvedValue(undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  test('retries every provider read in the failed-ticket path', async () => {
    await checkRetryables(
      { getTransactionReceipt: getParentTransactionReceipt } as any,
      {
        getTransaction,
        getTransactionReceipt: getChildTransactionReceipt,
      } as any,
      childChain,
      '0xbridge',
      1,
      2,
      true,
      onFailedRetryableFound
    )

    expect(getParentTransactionReceipt).toHaveBeenCalledTimes(2)
    expect(getParentToChildMessages).toHaveBeenCalledTimes(2)
    expect(status).toHaveBeenCalledTimes(2)
    expect(getTransaction).toHaveBeenCalledTimes(2)
    expect(getChildTransactionReceipt).toHaveBeenCalledTimes(2)
    expect(getChildChainRetryableReport).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD,
      })
    )
    expect(onFailedRetryableFound).toHaveBeenCalledTimes(1)
  })
})
