import { createPublicClient, defineChain, http, PublicClient } from 'viem'
import { ChainUptimeConfig, ChainUptimeResult, OnChainUpCallback, OnChainDownCallback } from './types'

/**
 * Checks if a chain is running by attempting to get the latest block number
 * 
 * @param config - Chain configuration with RPC URL and metadata
 * @param onSuccess - Callback executed when chain is up
 * @param onError - Callback executed when chain is down or error occurs
 * @returns Promise<ChainUptimeResult> - Result of the uptime check
 */
export const isChainRunning = async (
  config: ChainUptimeConfig,
  onSuccess?: OnChainUpCallback,
  onError?: OnChainDownCallback
): Promise<ChainUptimeResult> => {
  const { chain, timeout = 10000 } = config
  const startTime = Date.now()

  const viemChain = defineChain({
    id: chain.chainId,
    name: chain.name,
    network: 'custom',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [chain.orbitRpcUrl],
      },
      public: {
        http: [chain.orbitRpcUrl],
      },
    },
  })

  const publicClient: PublicClient = createPublicClient({
    chain: viemChain,
    transport: http(chain.orbitRpcUrl, {
      timeout,
    }),
  })

  const result: ChainUptimeResult = {
    chainId: chain.chainId,
    chainName: chain.name,
    rpcUrl: chain.orbitRpcUrl,
    isRunning: false,
  }

  try {
    const blockNumber = await publicClient.getBlockNumber()
    const responseTime = Date.now() - startTime

    result.isRunning = true
    result.blockNumber = blockNumber
    result.responseTime = responseTime

    if (onSuccess) {
      await onSuccess(result)
    }

    return result
  } catch (error) {
    const responseTime = Date.now() - startTime
    result.isRunning = false
    result.error = error instanceof Error ? error.message : String(error)
    result.responseTime = responseTime

    if (onError) {
      await onError(result)
    }

    return result
  }
}

