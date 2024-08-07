import { ChildNetwork } from 'utils'
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

export const getParentChainBlockTimeForBatchPosting = (
  childChain: ChildNetwork
) => {
  const parentChainId = childChain.parentChainId

  // for Base / Base Sepolia
  if (parentChainId === 8453 || parentChainId === 84532) return 2

  // for arbitrum networks, return the block-time corresponding to Ethereum
  return 12
}
