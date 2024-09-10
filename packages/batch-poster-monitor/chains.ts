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

// Defaults
export const MAX_TIMEBOUNDS_SECONDS = 60 * 60 * 24 // 24 hours : we don't care about txs older than 24 hours
export const BATCH_POSTING_TIMEBOUNDS_FALLBACK = 60 * 60 * 12 // fallback in case we can't derive the on-chain timebounds for batch posting
export const BATCH_POSTING_TIMEBOUNDS_BUFFER = 60 * 60 * 9 // reduce buffer (secs) from the time bounds for proactive alerting
export const MIN_DAYS_OF_BALANCE_LEFT = 3n // Number of days the batch-poster balance must last, else alert
export const MAX_LOGS_TO_PROCESS_FOR_BALANCE = 50 // Number of logs to process for batch poster balance estimation, there can be 1000+ logs for high activity chains
export const BATCH_POSTER_BALANCE_ALERT_THRESHOLD_FALLBACK = 0.1 // (ETH) Fallback if dynamic balance calculation doesn't go through

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

// we don't want to use orbit/sdk to call isAnyTrust for core chain
export const hardcodedAnyTrustCheckForCoreChainIds: { [id: number]: boolean } =
  {
    [mainnet.id]: false,
    [arbitrum.id]: false,
    [arbitrumNova.id]: true,
    [base.id]: false,
    [sepolia.id]: false,
    [holesky.id]: false,
    [arbitrumSepolia.id]: false,
    [baseSepolia.id]: false,
  }

export const getChainFromId = (chainId: number): Chain => {
  const chain = supportedParentChains.filter(chain => chain.id === chainId)
  return chain[0] ?? null
}

export const getMaxBlockRange = (chain: Chain): bigint => {
  switch (chain) {
    case mainnet:
    case sepolia:
    case holesky:
      return BigInt(MAX_TIMEBOUNDS_SECONDS / 12)

    case base:
    case baseSepolia:
      return BigInt(MAX_TIMEBOUNDS_SECONDS / 2)

    case arbitrum:
    case arbitrumNova:
    case arbitrumSepolia:
      return BigInt(MAX_TIMEBOUNDS_SECONDS * 4)
  }

  return 0n
}

// this is different from simple `getParentChainBlockTime` in retryable-tracker because we need to fallback to Ethereum values no matter what the chain
export const getParentChainBlockTimeForBatchPosting = (
  childChain: ChildNetwork
) => {
  const parentChainId = childChain.parentChainId

  // for Base / Base Sepolia
  if (parentChainId === 8453 || parentChainId === 84532) return 2

  // for arbitrum networks, return the block-time corresponding to Ethereum
  return 12
}
