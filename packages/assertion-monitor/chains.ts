import { Chain } from 'viem'
import type { ChildNetwork as ChainInfo } from 'utils'
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
import { CHUNK_SIZE } from './constants'

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
  const chain = supportedParentChains.find(chain => chain.id === chainId)
  if (!chain) {
    throw new Error(`Unsupported parent chain id ${chainId}`)
  }
  return chain
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

/**
 * Block time of the clock rollup contracts count confirmPeriodBlocks in.
 * On Arbitrum parent chains block.number returns the L1 block number, so
 * rollup periods tick at L1 speed rather than at the parent chain's block time.
 */
export const getRollupBlockTimeForChain = (chain: Chain): number => {
  switch (chain) {
    case arbitrum:
    case arbitrumNova:
      return getBlockTimeForChain(mainnet)

    case arbitrumSepolia:
      return getBlockTimeForChain(sepolia)

    default:
      return getBlockTimeForChain(chain)
  }
}

export const getConfirmPeriodSeconds = (chainInfo: ChainInfo): number =>
  chainInfo.confirmPeriodBlocks *
  getRollupBlockTimeForChain(getChainFromId(chainInfo.parentChainId))

/** Scales the log chunk size so each chunk spans roughly the same wall-clock time on fast parent chains. */
export const getLogChunkSizeForChain = (chain: Chain): bigint => {
  const blockTime = getBlockTimeForChain(chain)
  const multiplier = Math.max(
    1,
    Math.round(getBlockTimeForChain(mainnet) / blockTime)
  )
  return CHUNK_SIZE * BigInt(multiplier)
}
