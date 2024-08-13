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

export const DEFAULT_TIMESPAN_SECONDS = 60 * 60 * 24 * 7 // 1 week

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
    case base:
    case baseSepolia:
      return BigInt(DEFAULT_TIMESPAN_SECONDS / 2)

    default:
      return BigInt(DEFAULT_TIMESPAN_SECONDS / 12)
  }
}
