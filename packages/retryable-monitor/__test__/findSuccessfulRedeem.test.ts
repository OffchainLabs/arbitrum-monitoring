import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ArbRetryableTx__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ArbRetryableTx__factory'
import { findSuccessfulRedeem } from '../core/reportGenerator'

const iface = ArbRetryableTx__factory.createInterface()

const TICKET_ID = `0x${'11'.repeat(32)}`
const RETRY_TX_HASH = `0x${'22'.repeat(32)}`

const redeemScheduledLog = () => {
  const { data, topics } = iface.encodeEventLog(
    iface.getEvent('RedeemScheduled'),
    [TICKET_ID, RETRY_TX_HASH, 1, 0, `0x${'00'.repeat(20)}`, 0, 0]
  )
  return { data, topics }
}

const buildProvider = () =>
  ({
    _isProvider: true,
    getBlockNumber: vi.fn().mockResolvedValue(1_000),
    getLogs: vi.fn().mockResolvedValue([]),
    getTransactionReceipt: vi.fn().mockResolvedValue(null),
    getBlock: vi.fn().mockResolvedValue({ timestamp: 0 }),
  } as any)

describe('findSuccessfulRedeem', () => {
  let provider: any

  beforeEach(() => {
    provider = buildProvider()
  })

  test('returns the redeem tx hash when the ticket was redeemed', async () => {
    provider.getLogs.mockResolvedValue([redeemScheduledLog()])
    provider.getTransactionReceipt.mockResolvedValue({ status: 1 })

    await expect(findSuccessfulRedeem(TICKET_ID, 0, provider)).resolves.toBe(
      RETRY_TX_HASH
    )
  })

  test('ignores a redeem attempt that reverted', async () => {
    provider.getLogs.mockResolvedValue([redeemScheduledLog()])
    provider.getTransactionReceipt.mockResolvedValue({ status: 0 })

    await expect(
      findSuccessfulRedeem(TICKET_ID, 0, provider)
    ).resolves.toBeUndefined()
  })

  test('returns undefined when the ticket was never redeemed', async () => {
    await expect(
      findSuccessfulRedeem(TICKET_ID, 0, provider)
    ).resolves.toBeUndefined()
  })

  test('filters logs by the ticket id', async () => {
    await findSuccessfulRedeem(TICKET_ID, 0, provider)

    expect(provider.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        topics: expect.arrayContaining([TICKET_ID]),
      })
    )
  })

  test('splits the range into bounded chunks', async () => {
    provider.getBlockNumber.mockResolvedValue(10_000)

    await findSuccessfulRedeem(TICKET_ID, 0, provider)

    expect(provider.getLogs.mock.calls.length).toBeGreaterThan(1)
    for (const [{ fromBlock, toBlock }] of provider.getLogs.mock.calls) {
      expect(toBlock - fromBlock).toBeLessThan(2_000)
    }
  })

  test('stops scanning once the redeem is found', async () => {
    provider.getBlockNumber.mockResolvedValue(10_000)
    provider.getLogs.mockResolvedValueOnce([redeemScheduledLog()])
    provider.getTransactionReceipt.mockResolvedValue({ status: 1 })

    await expect(findSuccessfulRedeem(TICKET_ID, 0, provider)).resolves.toBe(
      RETRY_TX_HASH
    )

    expect(provider.getLogs).toHaveBeenCalledTimes(1)
  })
})
