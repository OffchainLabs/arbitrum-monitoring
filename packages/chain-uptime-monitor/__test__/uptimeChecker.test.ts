import { describe, expect, test, vi, beforeEach } from 'vitest'
import { isChainRunning } from '../core/uptimeChecker'
import { ChainUptimeConfig } from '../core/types'
import { createTestChainConfig } from './testConfigs'

// Mock viem
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(),
    defineChain: vi.fn((config) => config),
    http: vi.fn(),
  }
})

describe('isChainRunning', () => {
  let mockGetBlockNumber: ReturnType<typeof vi.fn>
  let mockPublicClient: any

  beforeEach(async () => {
    mockGetBlockNumber = vi.fn()
    mockPublicClient = {
      getBlockNumber: mockGetBlockNumber,
    }

    const { createPublicClient } = await import('viem')
    vi.mocked(createPublicClient).mockReturnValue(mockPublicClient as any)
  })

  test('should return success when chain is up', async () => {
    const blockNumber = 12345n
    mockGetBlockNumber.mockResolvedValue(blockNumber)

    const config: ChainUptimeConfig = {
      chain: createTestChainConfig(),
      timeout: 10000,
    }

    const onSuccess = vi.fn()
    const onError = vi.fn()

    const result = await isChainRunning(config, onSuccess, onError)

    expect(result.isRunning).toBe(true)
    expect(result.blockNumber).toBe(blockNumber)
    expect(result.error).toBeUndefined()
    expect(result.responseTime).toBeGreaterThanOrEqual(0)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  test('should return error when chain is down', async () => {
    const errorMessage = 'Connection timeout'
    mockGetBlockNumber.mockRejectedValue(new Error(errorMessage))

    const config: ChainUptimeConfig = {
      chain: createTestChainConfig(),
      timeout: 10000,
    }

    const onSuccess = vi.fn()
    const onError = vi.fn()

    const result = await isChainRunning(config, onSuccess, onError)

    expect(result.isRunning).toBe(false)
    expect(result.blockNumber).toBeUndefined()
    expect(result.error).toBe(errorMessage)
    expect(result.responseTime).toBeGreaterThanOrEqual(0)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  test('should handle network errors', async () => {
    const errorMessage = 'Network request failed'
    mockGetBlockNumber.mockRejectedValue(new Error(errorMessage))

    const config: ChainUptimeConfig = {
      chain: createTestChainConfig({ orbitRpcUrl: 'https://invalid-rpc-url.com' }),
      timeout: 5000,
    }

    const result = await isChainRunning(config)

    expect(result.isRunning).toBe(false)
    expect(result.error).toBe(errorMessage)
  })

  test('should work without callbacks', async () => {
    const blockNumber = 99999n
    mockGetBlockNumber.mockResolvedValue(blockNumber)

    const config: ChainUptimeConfig = {
      chain: createTestChainConfig(),
    }

    const result = await isChainRunning(config)

    expect(result.isRunning).toBe(true)
    expect(result.blockNumber).toBe(blockNumber)
  })
})

