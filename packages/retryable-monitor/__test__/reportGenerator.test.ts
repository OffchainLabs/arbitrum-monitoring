import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { BigNumber, utils } from 'ethers'
import { ParentToChildMessageStatus } from '@arbitrum/sdk'
import {
  ARB_RETRYABLE_TX_ADDRESS,
  SEVEN_DAYS_IN_SECONDS,
} from '@arbitrum/sdk/dist/lib/dataEntities/constants'

const { getTimeoutMock } = vi.hoisted(() => ({ getTimeoutMock: vi.fn() }))

vi.mock('@arbitrum/sdk/dist/lib/abi/factories/ArbRetryableTx__factory', () => ({
  ArbRetryableTx__factory: {
    connect: () => ({ callStatic: { getTimeout: getTimeoutMock } }),
  },
}))

import {
  getChildChainRetryableReport,
  TICKET_CREATED_TOPIC,
} from '../core/reportGenerator'

const CREATED_AT = 1783950953
const ON_CHAIN_TIMEOUT = 1785000000

const ticketCreatedLog = {
  address: ARB_RETRYABLE_TX_ADDRESS,
  topics: [utils.id('TicketCreated(bytes32)'), '0xticket'],
}

const buildArgs = (
  status: ParentToChildMessageStatus,
  receiptLogs: unknown[] = []
) => ({
  childChainTx: {
    maxFeePerGas: BigNumber.from(200000000),
    gasLimit: BigNumber.from(300000),
  } as any,
  childChainTxReceipt: { blockNumber: 123, logs: receiptLogs } as any,
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

  afterEach(() => {
    vi.useRealTimers()
  })

  test('hardcoded TICKET_CREATED_TOPIC matches the event signature hash', () => {
    expect(TICKET_CREATED_TOPIC).toBe(utils.id('TicketCreated(bytes32)'))
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

  test('reports created-but-dead CREATION_FAILED tickets as EXPIRED once past their lifetime', async () => {
    getTimeoutMock.mockRejectedValue(new Error('NoTicketWithID()'))
    vi.useFakeTimers()
    vi.setSystemTime(new Date((CREATED_AT + SEVEN_DAYS_IN_SECONDS + 60) * 1000))

    const report = await getChildChainRetryableReport(
      buildArgs(ParentToChildMessageStatus.CREATION_FAILED, [ticketCreatedLog])
    )

    expect(report.status).toBe(
      ParentToChildMessageStatus[ParentToChildMessageStatus.EXPIRED]
    )
    expect(report.timeoutTimestamp).toBe(
      String(CREATED_AT + SEVEN_DAYS_IN_SECONDS)
    )
  })

  test('keeps CREATION_FAILED for created-but-dead tickets still within their lifetime', async () => {
    getTimeoutMock.mockRejectedValue(new Error('NoTicketWithID()'))
    vi.useFakeTimers()
    vi.setSystemTime(new Date((CREATED_AT + SEVEN_DAYS_IN_SECONDS - 60) * 1000))

    const report = await getChildChainRetryableReport(
      buildArgs(ParentToChildMessageStatus.CREATION_FAILED, [ticketCreatedLog])
    )

    expect(report.status).toBe(
      ParentToChildMessageStatus[ParentToChildMessageStatus.CREATION_FAILED]
    )
  })

  test('keeps CREATION_FAILED past the lifetime when no TicketCreated event was emitted', async () => {
    getTimeoutMock.mockRejectedValue(new Error('NoTicketWithID()'))
    vi.useFakeTimers()
    vi.setSystemTime(new Date((CREATED_AT + SEVEN_DAYS_IN_SECONDS + 60) * 1000))

    const report = await getChildChainRetryableReport(
      buildArgs(ParentToChildMessageStatus.CREATION_FAILED, [
        { address: '0x0000000000000000000000000000000000000064', topics: [utils.id('TicketCreated(bytes32)')] },
        { address: ARB_RETRYABLE_TX_ADDRESS, topics: [utils.id('SomeOtherEvent(bytes32)')] },
      ])
    )

    expect(report.status).toBe(
      ParentToChildMessageStatus[ParentToChildMessageStatus.CREATION_FAILED]
    )
  })

  test('does not reclassify live CREATION_FAILED tickets past their original lifetime (keepalive)', async () => {
    getTimeoutMock.mockResolvedValue(
      BigNumber.from(CREATED_AT + 2 * SEVEN_DAYS_IN_SECONDS)
    )
    vi.useFakeTimers()
    vi.setSystemTime(new Date((CREATED_AT + SEVEN_DAYS_IN_SECONDS + 60) * 1000))

    const report = await getChildChainRetryableReport(
      buildArgs(ParentToChildMessageStatus.CREATION_FAILED, [ticketCreatedLog])
    )

    expect(report.status).toBe(
      ParentToChildMessageStatus[
        ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD
      ]
    )
    expect(report.timeoutTimestamp).toBe(
      String(CREATED_AT + 2 * SEVEN_DAYS_IN_SECONDS)
    )
  })

  test('recognizes the NoTicketWithID revert by custom error selector', async () => {
    getTimeoutMock.mockRejectedValue(
      Object.assign(new Error('call revert exception'), {
        data: '0x80698456',
      })
    )

    const report = await getChildChainRetryableReport(
      buildArgs(ParentToChildMessageStatus.CREATION_FAILED)
    )

    expect(report.status).toBe(
      ParentToChildMessageStatus[ParentToChildMessageStatus.CREATION_FAILED]
    )
  })

  test('does not misclassify the ticket as non-existent on unrelated errors', async () => {
    getTimeoutMock.mockRejectedValue(new Error('missing trie node'))

    await expect(
      getChildChainRetryableReport(
        buildArgs(ParentToChildMessageStatus.CREATION_FAILED)
      )
    ).rejects.toThrow('missing trie node')
  })

  test('does not query the precompile for statuses other than CREATION_FAILED', async () => {
    await getChildChainRetryableReport(
      buildArgs(ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD)
    )

    expect(getTimeoutMock).not.toHaveBeenCalled()
  })
})
