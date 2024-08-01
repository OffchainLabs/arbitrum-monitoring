import { Chain } from 'viem'
import {
  mainnet,
  arbitrum,
  arbitrumNova,
  base,
  sepolia,
  holesky,
  arbitrumSepolia,
  baseSepolia,
} from 'viem/chains'

// Defaults
export const DEFAULT_TIMESPAN_SECONDS = 60 * 60 * 12 // 12 hours
export const DEFAULT_BATCH_POSTING_DELAY_SECONDS = 60 * 60 * 4 // 4 hours
export const LOW_ETH_BALANCE_THRESHOLD_ETHEREUM = 1
export const LOW_ETH_BALANCE_THRESHOLD_ARBITRUM = 0.1

export const supportedParentChains = [
  mainnet,
  arbitrum,
  arbitrumNova,
  base,

  sepolia,
  holesky,
  arbitrumSepolia,
  baseSepolia,
]

export const getChainFromId = (chainId: number): Chain => {
  const chain = supportedParentChains.filter(chain => chain.id === chainId)
  return chain[0] ?? null
}

export const getDefaultBlockRange = (chain: Chain): bigint => {
  switch (chain) {
    case mainnet:
    case sepolia:
    case holesky:
      return BigInt(DEFAULT_TIMESPAN_SECONDS / 12)

    case base:
    case baseSepolia:
      return BigInt(DEFAULT_TIMESPAN_SECONDS / 2)

    case arbitrum:
    case arbitrumNova:
    case arbitrumSepolia:
      return BigInt(DEFAULT_TIMESPAN_SECONDS * 4)
  }

  return 0n
}
