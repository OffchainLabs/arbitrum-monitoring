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
const OTHER_CHAIN = {
  ...CHAIN,
  chainId: 9999,
  parentRpcUrl: 'https://other-parent.example',
  orbitRpcUrl: 'https://other-child.example',
}

const {
  precompileRedeem,
  waitForRedeem,
  getParentToChildMessages,
  messageStatus,
  getRetryableCreationReceipt,
  getTransactionReceipt,
  getBlock,
  jsonRpcProvider,
  getConfig,
} = vi.hoisted(() => {
  const getTransactionReceipt = vi.fn()
  const getBlock = vi.fn()
  return {
    precompileRedeem: vi.fn(),
    waitForRedeem: vi.fn(),
    getParentToChildMessages: vi.fn(),
    messageStatus: vi.fn(),
    getRetryableCreationReceipt: vi.fn(),
    getTransactionReceipt,
    getBlock,
    jsonRpcProvider: vi.fn(() => ({ getTransactionReceipt, getBlock })),
    getConfig: vi.fn(),
  }
})

const message = {
  retryableCreationId: TICKET_ID,
  status: messageStatus,
  getRetryableCreationReceipt,
}

vi.mock('utils', async importOriginal => ({
  ...(await importOriginal<typeof import('utils')>()),
  getConfig,
}))

vi.mock('ethers', async importOriginal => {
  const actual = await importOriginal<typeof import('ethers')>()
  return {
    ...actual,
    providers: {
      ...actual.providers,
      JsonRpcProvider: jsonRpcProvider,
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

vi.mock('@arbitrum/sdk/dist/lib/abi/factories/ArbRetryableTx__factory', () => ({
  ArbRetryableTx__factory: { connect: () => ({ redeem: precompileRedeem }) },
}))

vi.mock('../core/reportGenerator', () => ({
  getLiveTicketTimeout: vi.fn(),
  hasTicketCreatedEvent: vi.fn(),
  findSuccessfulRedeem: vi.fn(),
  isPastTicketLifetime: vi.fn(),
}))

import {
  getLiveRetryableStatus,
  locateRetryable,
  redeemRetryable,
} from '../core/redeemRetryable'
import {
  findSuccessfulRedeem,
  getLiveTicketTimeout,
  hasTicketCreatedEvent,
  isPastTicketLifetime,
} from '../core/reportGenerator'

const locate = async (options = {}) => {
  const located = await locateRetryable(PARENT_TX, options)
  if (!located) throw new Error('test ticket not found')
  return located
}

describe('redeemRetryable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RETRYABLE_MONITORING_PRIVATE_KEY = `0x${'01'.repeat(32)}`

    getConfig.mockReturnValue({ childChains: [CHAIN] })
    getTransactionReceipt.mockResolvedValue({ logs: [] })
    getBlock.mockResolvedValue({ timestamp: 0 })
    getParentToChildMessages.mockResolvedValue([message])
    messageStatus.mockResolvedValue(3)
    getRetryableCreationReceipt.mockResolvedValue({ blockNumber: 1, logs: [] })
    vi.mocked(getLiveTicketTimeout).mockResolvedValue({
      toString: () => '1',
    } as any)
    vi.mocked(hasTicketCreatedEvent).mockReturnValue(false)
    vi.mocked(findSuccessfulRedeem).mockResolvedValue(undefined)
    vi.mocked(isPastTicketLifetime).mockReturnValue(false)
    precompileRedeem.mockResolvedValue({ hash: REDEEM_TX })
    waitForRedeem.mockResolvedValue({ status: 1, transactionHash: RETRY_TX })
  })

  test('redeems via the precompile rather than the SDK status guard', async () => {
    await expect(
      redeemRetryable(await locate({ retryableCreationId: TICKET_ID }))
    ).resolves.toBe(RETRY_TX)

    expect(precompileRedeem).toHaveBeenCalledWith(TICKET_ID)
  })

  test('does not redeem a ticket that no longer exists', async () => {
    vi.mocked(getLiveTicketTimeout).mockResolvedValue(undefined)

    await expect(
      redeemRetryable(await locate({ retryableCreationId: TICKET_ID }))
    ).rejects.toThrow(/not redeemable/)

    expect(precompileRedeem).not.toHaveBeenCalled()
  })

  test('requires a signing key to redeem', async () => {
    delete process.env.RETRYABLE_MONITORING_PRIVATE_KEY

    await expect(redeemRetryable(await locate())).rejects.toThrow(
      /RETRYABLE_MONITORING_PRIVATE_KEY/
    )
    expect(precompileRedeem).not.toHaveBeenCalled()
  })

  test('throws when the scheduled retry execution reverted', async () => {
    waitForRedeem.mockResolvedValue({ status: 0, transactionHash: RETRY_TX })

    await expect(
      redeemRetryable(await locate({ retryableCreationId: TICKET_ID }))
    ).rejects.toThrow(/did not succeed/)
  })

  test('throws when the retry receipt is missing', async () => {
    waitForRedeem.mockResolvedValue(null)

    await expect(
      redeemRetryable(await locate({ retryableCreationId: TICKET_ID }))
    ).rejects.toThrow(/did not succeed/)
  })

  test('never redeems a sibling ticket from the same parent tx', async () => {
    getParentToChildMessages.mockResolvedValue([
      { retryableCreationId: `0x${'99'.repeat(32)}` },
    ])

    await expect(
      locateRetryable(PARENT_TX, { retryableCreationId: TICKET_ID })
    ).resolves.toBeNull()

    expect(precompileRedeem).not.toHaveBeenCalled()
  })
})

describe('getLiveRetryableStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RETRYABLE_MONITORING_PRIVATE_KEY = `0x${'01'.repeat(32)}`

    getConfig.mockReturnValue({ childChains: [CHAIN] })
    getTransactionReceipt.mockResolvedValue({ logs: [] })
    getBlock.mockResolvedValue({ timestamp: 100 })
    getParentToChildMessages.mockResolvedValue([message])
    messageStatus.mockResolvedValue(2)
    getRetryableCreationReceipt.mockResolvedValue({ blockNumber: 1, logs: [] })
    vi.mocked(getLiveTicketTimeout).mockResolvedValue(undefined)
    vi.mocked(hasTicketCreatedEvent).mockReturnValue(false)
    vi.mocked(findSuccessfulRedeem).mockResolvedValue(undefined)
    vi.mocked(isPastTicketLifetime).mockReturnValue(false)
  })

  test('returns the SDK redeemed status', async () => {
    messageStatus.mockResolvedValue(4)

    await expect(getLiveRetryableStatus(await locate())).resolves.toBe(4)
  })

  test.each([1, 3, 5])(
    'returns SDK status %s without extra resolution',
    async status => {
      messageStatus.mockResolvedValue(status)

      await expect(getLiveRetryableStatus(await locate())).resolves.toBe(status)
      expect(getRetryableCreationReceipt).not.toHaveBeenCalled()
    }
  )

  test('returns null when the parent transaction cannot be found', async () => {
    getTransactionReceipt.mockResolvedValue(null)

    await expect(locateRetryable(PARENT_TX)).resolves.toBeNull()
    expect(messageStatus).not.toHaveBeenCalled()
  })

  test('does not require a signing key for a live-status read', async () => {
    delete process.env.RETRYABLE_MONITORING_PRIVATE_KEY
    messageStatus.mockResolvedValue(3)

    await expect(getLiveRetryableStatus(await locate())).resolves.toBe(3)
  })

  test('keeps a genuine creation failure terminal', async () => {
    await expect(getLiveRetryableStatus(await locate())).resolves.toBe(2)

    expect(getLiveTicketTimeout).not.toHaveBeenCalled()
  })

  test('treats a reverted creation receipt with a live ticket as redeemable', async () => {
    vi.mocked(hasTicketCreatedEvent).mockReturnValue(true)
    vi.mocked(getLiveTicketTimeout).mockResolvedValue({} as any)

    await expect(getLiveRetryableStatus(await locate())).resolves.toBe(3)
  })

  test('detects a successful manual redeem of a reverted creation receipt', async () => {
    vi.mocked(hasTicketCreatedEvent).mockReturnValue(true)
    vi.mocked(findSuccessfulRedeem).mockResolvedValue(RETRY_TX)

    await expect(getLiveRetryableStatus(await locate())).resolves.toBe(4)
  })

  test('marks a created but dead ticket expired after its lifetime', async () => {
    vi.mocked(hasTicketCreatedEvent).mockReturnValue(true)
    vi.mocked(isPastTicketLifetime).mockReturnValue(true)

    await expect(getLiveRetryableStatus(await locate())).resolves.toBe(5)
    expect(isPastTicketLifetime).toHaveBeenCalledWith(100)
  })

  test('propagates an RPC failure instead of treating the ticket as dead', async () => {
    vi.mocked(hasTicketCreatedEvent).mockReturnValue(true)
    vi.mocked(getLiveTicketTimeout).mockRejectedValue(new Error('rpc down'))

    await expect(getLiveRetryableStatus(await locate())).rejects.toThrow(
      'rpc down'
    )
  })

  test('only probes the requested chain', async () => {
    getConfig.mockReturnValue({ childChains: [OTHER_CHAIN, CHAIN] })
    messageStatus.mockResolvedValue(4)

    await getLiveRetryableStatus(await locate({ chainId: CHAIN.chainId }))

    expect(jsonRpcProvider).toHaveBeenCalledWith(CHAIN.parentRpcUrl)
    expect(jsonRpcProvider).toHaveBeenCalledWith(CHAIN.orbitRpcUrl)
    expect(jsonRpcProvider).not.toHaveBeenCalledWith(OTHER_CHAIN.parentRpcUrl)
    expect(jsonRpcProvider).not.toHaveBeenCalledWith(OTHER_CHAIN.orbitRpcUrl)
  })
})
