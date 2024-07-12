import { Address, Chain } from 'viem'
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

// Monitored chains
export const orbitChains: OrbitChainInformation[] = [
  {
    name: 'Xai Mainnet',
    chainId: 660279,
    parentChainId: 42161,
    rpc: 'https://xai-chain.net/rpc',
    rollup: '0xC47DacFbAa80Bd9D8112F4e8069482c2A3221336',
    sequencerInbox: '0x995a9d3ca121D48d21087eDE20bc8acb2398c8B1',
    bridge: '0x7dd8A76bdAeBE3BBBaCD7Aa87f1D4FDa1E60f94f',
  },
  {
    name: 'Proof of Play (APEX)',
    chainId: 70700,
    parentChainId: 42161,
    rpc: 'https://rpc.apex.proofofplay.com',
    rollup: '0x65AD139061B3f6DDb16170a07b925337ddf42407',
    sequencerInbox: '0xa58F38102579dAE7C584850780dDA55744f67DF1',
    bridge: '0x074fFD20C6D8865752C997f4980Cf70F2a3Fbac6',
  },
]

export type OrbitChainInformation = {
  name: string
  chainId: number
  parentChainId: number
  rpc: string
  rollup: Address
  sequencerInbox: Address
  bridge: Address
}

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
