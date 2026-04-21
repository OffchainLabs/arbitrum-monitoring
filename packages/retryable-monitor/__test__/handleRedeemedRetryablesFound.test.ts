import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../handlers/notion/syncRetryableToNotion', () => ({
  syncRetryableToNotion: vi.fn(),
}))

vi.mock('../handlers/notion/fetchedNotionRetryablesUtils', () => ({
  hasFetchedNotionRetryables: vi.fn(),
  isRetryableInNotion: vi.fn(),
}))

import { handleRedeemedRetryablesFound } from '../handlers/handleRedeemedRetryablesFound'
import { syncRetryableToNotion } from '../handlers/notion/syncRetryableToNotion'
import {
  hasFetchedNotionRetryables,
  isRetryableInNotion,
} from '../handlers/notion/fetchedNotionRetryablesUtils'

const TICKET = {
  ChildTx: 'https://arbiscan.io/tx/0xdeadbeef',
  ParentTx: '0xaabb',
  ParentTxUrl: 'https://etherscan.io/tx/0xaabb',
  createdAt: 0,
  status: 'Executed',
  chainId: 42161,
  chain: 'Arbitrum One',
} as any

describe('handleRedeemedRetryablesFound', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  test('no-op when writeToNotion is false', async () => {
    await handleRedeemedRetryablesFound(TICKET, false)

    expect(syncRetryableToNotion).not.toHaveBeenCalled()
    expect(hasFetchedNotionRetryables).not.toHaveBeenCalled()
    expect(isRetryableInNotion).not.toHaveBeenCalled()
  })

  test('skips sync when the ticket is not in the fetched set (the rate-limit-fix path)', async () => {
    vi.mocked(hasFetchedNotionRetryables).mockReturnValue(true)
    vi.mocked(isRetryableInNotion).mockReturnValue(false)

    await handleRedeemedRetryablesFound(TICKET, true)

    expect(isRetryableInNotion).toHaveBeenCalledWith(TICKET.ChildTx)
    expect(syncRetryableToNotion).not.toHaveBeenCalled()
  })

  test('calls sync when the ticket is in the fetched set (update-to-Executed path)', async () => {
    vi.mocked(hasFetchedNotionRetryables).mockReturnValue(true)
    vi.mocked(isRetryableInNotion).mockReturnValue(true)

    await handleRedeemedRetryablesFound(TICKET, true)

    expect(syncRetryableToNotion).toHaveBeenCalledTimes(1)
    expect(syncRetryableToNotion).toHaveBeenCalledWith(TICKET)
  })

  test('falls back to sync when the initial fetch never succeeded', async () => {
    vi.mocked(hasFetchedNotionRetryables).mockReturnValue(false)

    await handleRedeemedRetryablesFound(TICKET, true)

    // short-circuits before the lookup — we never need to check membership
    expect(isRetryableInNotion).not.toHaveBeenCalled()
    expect(syncRetryableToNotion).toHaveBeenCalledTimes(1)
  })
})
