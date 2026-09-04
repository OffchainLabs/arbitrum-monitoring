import { beforeEach, describe, expect, test, vi } from 'vitest'

const TICKET_ID = `0x${'11'.repeat(32)}`
const PARENT_TX = `0x${'aa'.repeat(32)}`
const REDEEM_TX = `0x${'bb'.repeat(32)}`
const RETRY_TX = `0x${'cc'.repeat(32)}`

const CHAIN = {
  chainId: 4663,
  name: 'Robinhood Chain',
  parentRpcUrl: 'https://parent.example',
  orbitRpcUrl: 'https://child.example',
}

const precompileRedeem = vi.fn()
const waitForRedeem = vi.fn()
const getParentToChildMessages = vi.fn()

vi.mock('utils', async importOriginal => ({
  ...(await importOriginal<typeof import('utils')>()),
  getConfig: vi.fn(() => ({ childChains: [CHAIN] })),
}))

vi.mock('ethers', async importOriginal => {
  const actual = await importOriginal<typeof import('ethers')>()
  return {
    ...actual,
    providers: {
      ...actual.providers,
      JsonRpcProvider: vi.fn(() => ({
        getTransactionReceipt: vi.fn().mockResolvedValue({ logs: [] }),
      })),
    },
    Wallet: vi.fn(() => ({})),
  }
})

vi.mock('@arbitrum/sdk', () => ({
  ParentTransactionReceipt: vi.fn(() => ({ getParentToChildMessages })),
  ParentToChildMessageStatus: {
    1: 'NOT_YET_CREATED',
    2: 'CREATION_FAILED',
    3: 'FUNDS_DEPOSITED_ON_CHILD',
    4: 'REDEEMED',
    5: 'EXPIRED',
    NOT_YET_CREATED: 1,
    CREATION_FAILED: 2,
    FUNDS_DEPOSITED_ON_CHILD: 3,
    REDEEMED: 4,
    EXPIRED: 5,
  },
  ChildTransactionReceipt: {
    monkeyPatchWait: (tx: unknown) => tx,
    toRedeemTransaction: () => ({ waitForRedeem }),
  },
}))

vi.mock(
  '@arbitrum/sdk/dist/lib/abi/factories/ArbRetryableTx__factory',
  () => ({
    ArbRetryableTx__factory: { connect: () => ({ redeem: precompileRedeem }) },
  })
)

vi.mock('../core/reportGenerator', () => ({
  getLiveTicketTimeout: vi.fn(),
  hasTicketCreatedEvent: vi.fn(),
  findSuccessfulRedeem: vi.fn(),
}))

import { redeemRetryable } from '../core/redeemRetryable'
import { getLiveTicketTimeout } from '../core/reportGenerator'

describe('redeemRetryable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RETRYABLE_MONITORING_PRIVATE_KEY = `0x${'01'.repeat(32)}`

    getParentToChildMessages.mockResolvedValue([
      { retryableCreationId: TICKET_ID },
    ])
    vi.mocked(getLiveTicketTimeout).mockResolvedValue({ toString: () => '1' } as any)
    precompileRedeem.mockResolvedValue({ hash: REDEEM_TX })
    waitForRedeem.mockResolvedValue({ status: 1, transactionHash: RETRY_TX })
  })

  test('redeems via the precompile rather than the SDK status guard', async () => {
    await expect(
      redeemRetryable(PARENT_TX, { retryableCreationId: TICKET_ID })
    ).resolves.toBe(RETRY_TX)

    expect(precompileRedeem).toHaveBeenCalledWith(TICKET_ID)
  })

  test('does not redeem a ticket that no longer exists', async () => {
    vi.mocked(getLiveTicketTimeout).mockResolvedValue(undefined)

    await expect(
      redeemRetryable(PARENT_TX, { retryableCreationId: TICKET_ID })
    ).rejects.toThrow(/not found\/redeemable/)

    expect(precompileRedeem).not.toHaveBeenCalled()
  })

  test('throws when the scheduled retry execution reverted', async () => {
    waitForRedeem.mockResolvedValue({ status: 0, transactionHash: RETRY_TX })

    await expect(
      redeemRetryable(PARENT_TX, { retryableCreationId: TICKET_ID })
    ).rejects.toThrow(/did not succeed/)
  })

  test('throws when the retry receipt is missing', async () => {
    waitForRedeem.mockResolvedValue(null)

    await expect(
      redeemRetryable(PARENT_TX, { retryableCreationId: TICKET_ID })
    ).rejects.toThrow(/did not succeed/)
  })

  test('never redeems a sibling ticket from the same parent tx', async () => {
    getParentToChildMessages.mockResolvedValue([
      { retryableCreationId: `0x${'99'.repeat(32)}` },
    ])

    await expect(
      redeemRetryable(PARENT_TX, { retryableCreationId: TICKET_ID })
    ).rejects.toThrow(/not found\/redeemable/)

    expect(precompileRedeem).not.toHaveBeenCalled()
  })
})
