import { ArbitrumNetwork } from '@arbitrum/sdk'

// Interface defining additional properties for ChildNetwork
export interface ChildNetwork extends ArbitrumNetwork {
  parentRpcUrl: string
  orbitRpcUrl: string
  explorerUrl: string
  parentExplorerUrl: string
}
