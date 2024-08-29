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
      return 0.25

    default:
      return 1
  }
}
