import { ChildNetwork } from '../../utils'

export interface ChainUptimeConfig {
  chain: ChildNetwork
  timeout?: number // Timeout in milliseconds (default: 10000)
}

export interface ChainUptimeResult {
  chainId: number
  chainName: string
  rpcUrl: string
  isRunning: boolean
  blockNumber?: bigint
  error?: string
  responseTime?: number // Response time in milliseconds
}

export type OnChainUpCallback = (result: ChainUptimeResult) => Promise<void> | void
export type OnChainDownCallback = (result: ChainUptimeResult) => Promise<void> | void

