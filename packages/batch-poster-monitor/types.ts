import { Address } from 'viem'

export type BatchPosterMonitorOptions = {
  configPath: string
  enableAlerting: boolean
}

export type ChainInfo = {
  name: string
  chainId: number
  parentChainId: number
  rpc: string
  rollup: Address
  sequencerInbox: Address
  bridge: Address
}
