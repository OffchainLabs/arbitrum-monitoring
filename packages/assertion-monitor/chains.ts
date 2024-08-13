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

export const getDefaultBlockRange = (chain: Chain): bigint => {
  switch (chain) {
    case mainnet:
    case sepolia:
    case holesky:
      return BigInt(DEFAULT_TIME_SPAN_SECONDS / 12)

    case base:
    case baseSepolia:
      return BigInt(DEFAULT_TIME_SPAN_SECONDS / 2)

    case arbitrum:
    case arbitrumNova:
    case arbitrumSepolia:
      return BigInt(DEFAULT_TIME_SPAN_SECONDS * 4)

    default:
      return BigInt(DEFAULT_TIME_SPAN_SECONDS)
  }
}
