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

export const DEFAULT_TIME_SPAN_SECONDS = 60 * 60 * 24 * 7 // 1 week

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

export const getBlockTimeForChain = (chain: Chain): number => {
  switch (chain) {
    case mainnet:
    case sepolia:
    case holesky:
      return 12

    case base:
    case baseSepolia:
      return 2

    case arbitrum:
    case arbitrumNova:
    case arbitrumSepolia:
      return 4

    default:
      return 1
  }
}

export const getDefaultBlockRange = (chain: Chain): bigint => {
  return BigInt(DEFAULT_TIME_SPAN_SECONDS / getBlockTimeForChain(chain))
}
