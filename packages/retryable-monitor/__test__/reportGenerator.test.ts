import { describe, expect, test, vi, beforeEach } from 'vitest'
import { BigNumber } from 'ethers'
import { ParentToChildMessageStatus } from '@arbitrum/sdk'
import { SEVEN_DAYS_IN_SECONDS } from '@arbitrum/sdk/dist/lib/dataEntities/constants'

const { getTimeoutMock } = vi.hoisted(() => ({ getTimeoutMock: vi.fn() }))

vi.mock('@arbitrum/sdk/dist/lib/abi/factories/ArbRetryableTx__factory', () => ({
  ArbRetryableTx__factory: {
    connect: () => ({ callStatic: { getTimeout: getTimeoutMock } }),
  },
}))

import { getChildChainRetryableReport } from '../core/reportGenerator'

const CREATED_AT = 1783950953
const ON_CHAIN_TIMEOUT = 1785000000

const buildArgs = (status: ParentToChildMessageStatus) => ({
  childChainTx: {
    maxFeePerGas: BigNumber.from(200000000),
    gasLimit: BigNumber.from(300000),
  } as any,
  childChainTxReceipt: { blockNumber: 123 } as any,
  retryableMessage: {
    retryableCreationId: '0xticket',
    status: async () => status,
    getAutoRedeemAttempt: async () => null,
    messageData: {
      l2CallValue: BigNumber.from(0),
      destAddress: '0xdest',
      data: '0x',
      excessFeeRefundAddress: '0xfee',
      callValueRefundAddress: '0xbeneficiary',
    },
  } as any,
  childChainProvider: {
    getBlock: async () => ({ timestamp: CREATED_AT }),
  } as any,
})

describe('getChildChainRetryableReport', () => {
  beforeEach(() => {
    getTimeoutMock.mockReset()
  })

  test('stores createdAtTimestamp in seconds, same unit as timeoutTimestamp', async () => {
    const report = await getChildChainRetryableReport(
      buildArgs(ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD)
    )

    expect(report.createdAtTimestamp).toBe(String(CREATED_AT))
    expect(report.timeoutTimestamp).toBe(
      String(CREATED_AT + SEVEN_DAYS_IN_SECONDS)
    )
  })

  test('reports CREATION_FAILED tickets that are live on-chain as unredeemed, with their actual timeout', async () => {
    getTimeoutMock.mockResolvedValue(BigNumber.from(ON_CHAIN_TIMEOUT))

    const report = await getChildChainRetryableReport(
      buildArgs(ParentToChildMessageStatus.CREATION_FAILED)
    )

    expect(report.status).toBe(
      ParentToChildMessageStatus[
        ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD
      ]
    )
    expect(report.timeoutTimestamp).toBe(String(ON_CHAIN_TIMEOUT))
  })

  test('keeps CREATION_FAILED when no live ticket exists on-chain', async () => {
    getTimeoutMock.mockRejectedValue(new Error('NoTicketWithID()'))

    const report = await getChildChainRetryableReport(
      buildArgs(ParentToChildMessageStatus.CREATION_FAILED)
    )

    expect(report.status).toBe(
      ParentToChildMessageStatus[ParentToChildMessageStatus.CREATION_FAILED]
    )
    expect(report.timeoutTimestamp).toBe(
      String(CREATED_AT + SEVEN_DAYS_IN_SECONDS)
    )
  })

  test('does not query the precompile for statuses other than CREATION_FAILED', async () => {
    await getChildChainRetryableReport(
      buildArgs(ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD)
    )

    expect(getTimeoutMock).not.toHaveBeenCalled()
  })
})
