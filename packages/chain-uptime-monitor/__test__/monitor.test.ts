import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { createTestChains } from './testConfigs'
import * as fs from 'fs'

// Mock require.main to simulate running as entry point
const originalRequireMain = require.main

// Mock dependencies
vi.mock('../../utils', async () => {
  const actual = await vi.importActual('../../utils')
  return {
    ...actual,
    getConfig: vi.fn(),
    postSlackMessage: vi.fn(),
  }
})

vi.mock('../core/uptimeChecker', () => ({
  isChainRunning: vi.fn(),
}))

vi.mock('../handlers/slack/reportUptimeAlertToSlack', () => ({
  reportUptimeAlertToSlack: vi.fn(),
}))

describe('Chain Uptime Monitor', () => {
  let mockGetConfig: ReturnType<typeof vi.fn>
  let mockPostSlackMessage: ReturnType<typeof vi.fn>
  let mockIsChainRunning: ReturnType<typeof vi.fn>
  let mockReportUptimeAlertToSlack: ReturnType<typeof vi.fn>
  let originalEnv: NodeJS.ProcessEnv
  let originalExit: typeof process.exit

  beforeEach(async () => {
    originalEnv = { ...process.env }
    originalExit = process.exit
    process.exit = vi.fn() as any

    // Mock require.main to simulate entry point
    require.main = { filename: __filename } as any

    const utils = await import('../../utils')
    mockGetConfig = vi.mocked(utils.getConfig)
    mockPostSlackMessage = vi.mocked(utils.postSlackMessage)

    const uptimeChecker = await import('../core/uptimeChecker')
    mockIsChainRunning = vi.mocked(uptimeChecker.isChainRunning)

    const slackHandler = await import(
      '../handlers/slack/reportUptimeAlertToSlack'
    )
    mockReportUptimeAlertToSlack = vi.mocked(
      slackHandler.reportUptimeAlertToSlack
    )

    // Reset mocks
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
    process.exit = originalExit
    require.main = originalRequireMain
    // Clear module cache to allow fresh imports
    vi.resetModules()
  })

  test('should handle all chains up - no alerts sent', async () => {
    const chains = createTestChains()
    mockGetConfig.mockReturnValue({ childChains: chains })

    // All chains up
    mockIsChainRunning.mockImplementation(async (config, onSuccess) => {
      const result = {
        chainId: config.chain.chainId,
        chainName: config.chain.name,
        rpcUrl: config.chain.orbitRpcUrl,
        isRunning: true,
        blockNumber: 12345n,
        responseTime: 100,
      }
      if (onSuccess) await onSuccess(result)
      return result
    })

    process.env.CHAIN_UPTIME_MONITORING_SLACK_TOKEN = 'test-token'
    process.env.CHAIN_UPTIME_MONITORING_SLACK_CHANNEL = 'test-channel'

    // Mock process.argv for yargs
    const originalArgv = process.argv
    process.argv = [
      'node',
      'index.ts',
      '--enableAlerting',
      '--consolidateAlerts',
    ]

    // Mock require.main to prevent the module from executing
    require.main = null as any

    // Import and call the exported monitor function
    const { monitorChainUptime } = await import('../index')
    await monitorChainUptime()

    expect(mockIsChainRunning).toHaveBeenCalledTimes(4)
    expect(mockPostSlackMessage).not.toHaveBeenCalled()
    expect(mockReportUptimeAlertToSlack).not.toHaveBeenCalled()
    // process.exit(0) is only called in the entry point, not when calling the function directly
    expect(process.exit).not.toHaveBeenCalled()

    process.argv = originalArgv
  })

  test('should handle 1 down, 3 up - send consolidated alert', async () => {
    const chains = createTestChains()
    mockGetConfig.mockReturnValue({ childChains: chains })

    let callCount = 0
    mockIsChainRunning.mockImplementation(
      async (config, onSuccess, onError) => {
        callCount++
        const isDown = callCount === 2 // Second chain is down

        if (isDown) {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: false,
            error: 'Connection timeout',
            responseTime: 5000,
          }
          if (onError) await onError(result)
          return result
        } else {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: true,
            blockNumber: 12345n,
            responseTime: 100,
          }
          if (onSuccess) await onSuccess(result)
          return result
        }
      }
    )

    process.env.CHAIN_UPTIME_MONITORING_SLACK_TOKEN = 'test-token'
    process.env.CHAIN_UPTIME_MONITORING_SLACK_CHANNEL = 'test-channel'

    const originalArgv = process.argv
    process.argv = [
      'node',
      'index.ts',
      '--enableAlerting',
      '--consolidateAlerts',
    ]

    require.main = null as any
    const { monitorChainUptime } = await import('../index')
    await monitorChainUptime()

    expect(mockIsChainRunning).toHaveBeenCalledTimes(4)
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1)
    expect(mockReportUptimeAlertToSlack).not.toHaveBeenCalled() // Not called in consolidated mode
    expect(process.exit).toHaveBeenCalledWith(1)

    // Verify consolidated message content
    const slackCall = mockPostSlackMessage.mock.calls[0][0]
    expect(slackCall.message).toContain('Chain Uptime Alert')
    expect(slackCall.message).toContain('Down: 1')
    expect(slackCall.message).toContain('Up: 3')
    expect(slackCall.message).toContain('Chain 2')

    process.argv = originalArgv
  })

  test('should handle 2 down, 2 up - send consolidated alert', async () => {
    const chains = createTestChains()
    mockGetConfig.mockReturnValue({ childChains: chains })

    let callCount = 0
    mockIsChainRunning.mockImplementation(
      async (config, onSuccess, onError) => {
        callCount++
        const isDown = callCount === 1 || callCount === 3 // First and third chains are down

        if (isDown) {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: false,
            error: 'Network error',
            responseTime: 10000,
          }
          if (onError) await onError(result)
          return result
        } else {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: true,
            blockNumber: 12345n,
            responseTime: 150,
          }
          if (onSuccess) await onSuccess(result)
          return result
        }
      }
    )

    process.env.CHAIN_UPTIME_MONITORING_SLACK_TOKEN = 'test-token'
    process.env.CHAIN_UPTIME_MONITORING_SLACK_CHANNEL = 'test-channel'

    const originalArgv = process.argv
    process.argv = [
      'node',
      'index.ts',
      '--enableAlerting',
      '--consolidateAlerts',
    ]

    require.main = null as any
    const { monitorChainUptime } = await import('../index')
    await monitorChainUptime()

    expect(mockIsChainRunning).toHaveBeenCalledTimes(4)
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1)
    expect(process.exit).toHaveBeenCalledWith(1)

    const slackCall = mockPostSlackMessage.mock.calls[0][0]
    expect(slackCall.message).toContain('Down: 2')
    expect(slackCall.message).toContain('Up: 2')

    process.argv = originalArgv
  })

  test('should handle all chains down', async () => {
    const chains = createTestChains()
    mockGetConfig.mockReturnValue({ childChains: chains })

    mockIsChainRunning.mockImplementation(
      async (config, onSuccess, onError) => {
        const result = {
          chainId: config.chain.chainId,
          chainName: config.chain.name,
          rpcUrl: config.chain.orbitRpcUrl,
          isRunning: false,
          error: 'RPC endpoint unavailable',
          responseTime: 10000,
        }
        if (onError) await onError(result)
        return result
      }
    )

    process.env.CHAIN_UPTIME_MONITORING_SLACK_TOKEN = 'test-token'
    process.env.CHAIN_UPTIME_MONITORING_SLACK_CHANNEL = 'test-channel'

    const originalArgv = process.argv
    process.argv = [
      'node',
      'index.ts',
      '--enableAlerting',
      '--consolidateAlerts',
    ]

    require.main = null as any
    const { monitorChainUptime } = await import('../index')
    await monitorChainUptime()

    expect(mockIsChainRunning).toHaveBeenCalledTimes(4)
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1)
    expect(process.exit).toHaveBeenCalledWith(1)

    const slackCall = mockPostSlackMessage.mock.calls[0][0]
    expect(slackCall.message).toContain('Down: 4')
    expect(slackCall.message).toContain('Up: 0')

    process.argv = originalArgv
  })

  test('should send individual alerts when consolidateAlerts is false', async () => {
    const chains = createTestChains()
    mockGetConfig.mockReturnValue({ childChains: chains })

    let callCount = 0
    mockIsChainRunning.mockImplementation(
      async (config, onSuccess, onError) => {
        callCount++
        const isDown = callCount === 2

        if (isDown) {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: false,
            error: 'Connection timeout',
            responseTime: 5000,
          }
          if (onError) await onError(result)
          return result
        } else {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: true,
            blockNumber: 12345n,
            responseTime: 100,
          }
          if (onSuccess) await onSuccess(result)
          return result
        }
      }
    )

    process.env.CHAIN_UPTIME_MONITORING_SLACK_TOKEN = 'test-token'
    process.env.CHAIN_UPTIME_MONITORING_SLACK_CHANNEL = 'test-channel'

    const originalArgv = process.argv
    process.argv = [
      'node',
      'index.ts',
      '--enableAlerting',
      '--no-consolidateAlerts',
    ]

    require.main = null as any
    const { monitorChainUptime } = await import('../index')
    await monitorChainUptime()

    expect(mockIsChainRunning).toHaveBeenCalledTimes(4)
    // Individual alert for the down chain only
    expect(mockReportUptimeAlertToSlack).toHaveBeenCalledTimes(1)
    expect(mockPostSlackMessage).not.toHaveBeenCalled() // No consolidated message
    expect(process.exit).toHaveBeenCalledWith(1)

    process.argv = originalArgv
  })

  test('should not send alerts when enableAlerting is false', async () => {
    const chains = createTestChains()
    mockGetConfig.mockReturnValue({ childChains: chains })

    let callCount = 0
    mockIsChainRunning.mockImplementation(
      async (config, onSuccess, onError) => {
        callCount++
        const isDown = callCount === 2

        if (isDown) {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: false,
            error: 'Connection timeout',
            responseTime: 5000,
          }
          if (onError) await onError(result)
          return result
        } else {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: true,
            blockNumber: 12345n,
            responseTime: 100,
          }
          if (onSuccess) await onSuccess(result)
          return result
        }
      }
    )

    const originalArgv = process.argv
    process.argv = ['node', 'index.ts'] // No --enableAlerting

    require.main = null as any
    const { monitorChainUptime } = await import('../index')
    await monitorChainUptime()

    expect(mockIsChainRunning).toHaveBeenCalledTimes(4)
    expect(mockPostSlackMessage).not.toHaveBeenCalled()
    expect(mockReportUptimeAlertToSlack).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(1) // Still exits with error

    process.argv = originalArgv
  })

  test('should handle errors during chain checking', async () => {
    const chains = createTestChains()
    mockGetConfig.mockReturnValue({ childChains: chains })

    let callCount = 0
    mockIsChainRunning.mockImplementation(async config => {
      callCount++
      if (callCount === 2) {
        throw new Error('Unexpected error during check')
      }
      return {
        chainId: config.chain.chainId,
        chainName: config.chain.name,
        rpcUrl: config.chain.orbitRpcUrl,
        isRunning: true,
        blockNumber: 12345n,
        responseTime: 100,
      }
    })

    process.env.CHAIN_UPTIME_MONITORING_SLACK_TOKEN = 'test-token'
    process.env.CHAIN_UPTIME_MONITORING_SLACK_CHANNEL = 'test-channel'

    const originalArgv = process.argv
    process.argv = [
      'node',
      'index.ts',
      '--enableAlerting',
      '--consolidateAlerts',
    ]

    require.main = null as any
    const { monitorChainUptime } = await import('../index')
    await monitorChainUptime()

    expect(mockIsChainRunning).toHaveBeenCalledTimes(4)
    // Should still send alert for the error case
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1)
    expect(process.exit).toHaveBeenCalledWith(1)

    process.argv = originalArgv
  })

  test('should respect --enableAlerting flag - send alerts when enabled', async () => {
    const chains = createTestChains()
    mockGetConfig.mockReturnValue({ childChains: chains })

    let callCount = 0
    mockIsChainRunning.mockImplementation(
      async (config, onSuccess, onError) => {
        callCount++
        const isDown = callCount === 2

        if (isDown) {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: false,
            error: 'Connection timeout',
            responseTime: 5000,
          }
          if (onError) await onError(result)
          return result
        } else {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: true,
            blockNumber: 12345n,
            responseTime: 100,
          }
          if (onSuccess) await onSuccess(result)
          return result
        }
      }
    )

    process.env.CHAIN_UPTIME_MONITORING_SLACK_TOKEN = 'test-token'
    process.env.CHAIN_UPTIME_MONITORING_SLACK_CHANNEL = 'test-channel'

    const originalArgv = process.argv
    process.argv = ['node', 'index.ts', '--enableAlerting']

    require.main = null as any
    const { monitorChainUptime } = await import('../index')
    await monitorChainUptime()

    expect(mockIsChainRunning).toHaveBeenCalledTimes(4)
    // With --enableAlerting, should send consolidated alert (default consolidateAlerts is true)
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1)
    expect(mockReportUptimeAlertToSlack).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(1)

    process.argv = originalArgv
  })

  test('should respect --enableAlerting flag - no alerts when disabled', async () => {
    const chains = createTestChains()
    mockGetConfig.mockReturnValue({ childChains: chains })

    let callCount = 0
    mockIsChainRunning.mockImplementation(
      async (config, onSuccess, onError) => {
        callCount++
        const isDown = callCount === 2

        if (isDown) {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: false,
            error: 'Connection timeout',
            responseTime: 5000,
          }
          if (onError) await onError(result)
          return result
        } else {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: true,
            blockNumber: 12345n,
            responseTime: 100,
          }
          if (onSuccess) await onSuccess(result)
          return result
        }
      }
    )

    const originalArgv = process.argv
    process.argv = ['node', 'index.ts'] // No --enableAlerting

    require.main = null as any
    const { monitorChainUptime } = await import('../index')
    await monitorChainUptime()

    expect(mockIsChainRunning).toHaveBeenCalledTimes(4)
    // Without --enableAlerting, should not send any alerts
    expect(mockPostSlackMessage).not.toHaveBeenCalled()
    expect(mockReportUptimeAlertToSlack).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(1) // Still exits with error

    process.argv = originalArgv
  })

  test('should respect --consolidateAlerts flag - send consolidated alert when enabled', async () => {
    const chains = createTestChains()
    mockGetConfig.mockReturnValue({ childChains: chains })

    let callCount = 0
    mockIsChainRunning.mockImplementation(
      async (config, onSuccess, onError) => {
        callCount++
        const isDown = callCount === 2

        if (isDown) {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: false,
            error: 'Connection timeout',
            responseTime: 5000,
          }
          if (onError) await onError(result)
          return result
        } else {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: true,
            blockNumber: 12345n,
            responseTime: 100,
          }
          if (onSuccess) await onSuccess(result)
          return result
        }
      }
    )

    process.env.CHAIN_UPTIME_MONITORING_SLACK_TOKEN = 'test-token'
    process.env.CHAIN_UPTIME_MONITORING_SLACK_CHANNEL = 'test-channel'

    const originalArgv = process.argv
    process.argv = [
      'node',
      'index.ts',
      '--enableAlerting',
      '--consolidateAlerts',
    ]

    require.main = null as any
    const { monitorChainUptime } = await import('../index')
    await monitorChainUptime()

    expect(mockIsChainRunning).toHaveBeenCalledTimes(4)
    // With --consolidateAlerts, should send one consolidated message
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1)
    expect(mockReportUptimeAlertToSlack).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(1)

    process.argv = originalArgv
  })

  test('should respect --no-consolidateAlerts flag - send individual alerts', async () => {
    const chains = createTestChains()
    mockGetConfig.mockReturnValue({ childChains: chains })

    let callCount = 0
    mockIsChainRunning.mockImplementation(
      async (config, onSuccess, onError) => {
        callCount++
        const isDown = callCount === 2

        if (isDown) {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: false,
            error: 'Connection timeout',
            responseTime: 5000,
          }
          if (onError) await onError(result)
          return result
        } else {
          const result = {
            chainId: config.chain.chainId,
            chainName: config.chain.name,
            rpcUrl: config.chain.orbitRpcUrl,
            isRunning: true,
            blockNumber: 12345n,
            responseTime: 100,
          }
          if (onSuccess) await onSuccess(result)
          return result
        }
      }
    )

    process.env.CHAIN_UPTIME_MONITORING_SLACK_TOKEN = 'test-token'
    process.env.CHAIN_UPTIME_MONITORING_SLACK_CHANNEL = 'test-channel'

    const originalArgv = process.argv
    process.argv = [
      'node',
      'index.ts',
      '--enableAlerting',
      '--no-consolidateAlerts',
    ]

    require.main = null as any
    const { monitorChainUptime } = await import('../index')
    await monitorChainUptime()

    expect(mockIsChainRunning).toHaveBeenCalledTimes(4)
    // With --no-consolidateAlerts, should send individual alerts for down chains
    expect(mockReportUptimeAlertToSlack).toHaveBeenCalledTimes(1) // Only for down chain
    expect(mockPostSlackMessage).not.toHaveBeenCalled() // No consolidated message
    expect(process.exit).toHaveBeenCalledWith(1)

    process.argv = originalArgv
  })
})
