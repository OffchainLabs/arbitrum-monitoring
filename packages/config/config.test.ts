import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { ChildChains, getConfig } from '.'

vi.mock('fs')
vi.mock('path')

describe('getConfig', () => {
  const mockConfigPath = '/mock/path/config.json'
  const mockCwd = '/mock/cwd'

  beforeEach(() => {
    vi.mocked(path.join).mockImplementation(() => mockConfigPath)
    vi.spyOn(process, 'cwd').mockImplementation(() => mockCwd)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should successfully load and validate a correct config', () => {
    const mockConfig: ChildChains = {
      childChains: [
        {
          chainId: 123,
          confirmPeriodBlocks: 150,
          ethBridge: {
            bridge: '0x1234567890123456789012345678901234567890',
            inbox: '0x1234567890123456789012345678901234567890',
            outbox: '0x1234567890123456789012345678901234567890',
            rollup: '0x1234567890123456789012345678901234567890',
            sequencerInbox: '0x1234567890123456789012345678901234567890',
          },
          nativeToken: '0x1234567890123456789012345678901234567890',
          explorerUrl: 'https://example.com',
          rpcUrl: 'https://rpc.example.com',
          name: 'Test Chain',
          slug: 'test-chain',
          parentChainId: 1,
          retryableLifetimeSeconds: 604800,
          isCustom: true,
          tokenBridge: {
            parentCustomGateway: '0x1234567890123456789012345678901234567890',
            parentErc20Gateway: '0x1234567890123456789012345678901234567890',
            parentGatewayRouter: '0x1234567890123456789012345678901234567890',
            parentMultiCall: '0x1234567890123456789012345678901234567890',
            parentProxyAdmin: '0x1234567890123456789012345678901234567890',
            parentWeth: '0x1234567890123456789012345678901234567890',
            parentWethGateway: '0x1234567890123456789012345678901234567890',
            childCustomGateway: '0x1234567890123456789012345678901234567890',
            childErc20Gateway: '0x1234567890123456789012345678901234567890',
            childGatewayRouter: '0x1234567890123456789012345678901234567890',
            childMultiCall: '0x1234567890123456789012345678901234567890',
            childProxyAdmin: '0x1234567890123456789012345678901234567890',
            childWeth: '0x1234567890123456789012345678901234567890',
            childWethGateway: '0x1234567890123456789012345678901234567890',
          },
          bridgeUiConfig: {
            color: '#FF0000',
            network: {
              name: 'Test Network',
              logo: '/path/to/logo.svg',
              description: 'A test network',
            },
            nativeTokenData: {
              name: 'Test Token',
              symbol: 'TST',
              decimals: 18,
              logoUrl: '/path/to/token-logo.svg',
            },
          },
          orbitRpcUrl: 'https://orbit-rpc.example.com',
          parentRpcUrl: 'https://parent-rpc.example.com',
          parentExplorerUrl: 'https://parent-explorer.example.com',
        },
      ],
    }

    vi.spyOn(fs, 'readFileSync').mockImplementation(() =>
      JSON.stringify(mockConfig)
    )

    const result = getConfig({ configPath: 'config.json' })
    expect(result).toEqual(mockConfig)
  })

  it('should throw an error for invalid JSON', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => '{ invalid json }')

    expect(() => getConfig({ configPath: 'config.json' })).toThrow(
      'Invalid JSON in the config file'
    )
  })

  it('should throw an error for config not matching the schema', () => {
    const invalidConfig = {
      childChains: [
        {
          // Missing required fields
          chainId: 123,
          name: 'Invalid Chain',
        },
      ],
    }

    vi.spyOn(fs, 'readFileSync').mockImplementation(() =>
      JSON.stringify(invalidConfig)
    )

    expect(() => getConfig({ configPath: 'config.json' })).toThrow(
      'Error reading or parsing config file'
    )
  })

  it('should throw an error if the config file is not found', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory')
    })

    expect(() => getConfig({ configPath: 'nonexistent.json' })).toThrow(
      'Error reading or parsing config file: ENOENT: no such file or directory'
    )
  })
})
