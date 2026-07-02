import { ArbitrumNetwork } from '@arbitrum/sdk'

// Interface defining additional properties for ChildNetwork
export interface ChildNetwork extends ArbitrumNetwork {
  parentRpcUrl: string
  orbitRpcUrl: string
  explorerUrl: string
  parentExplorerUrl: string
  /** Operator-run node to health-check with node-sync-monitor; orbitRpcUrl is used as the trusted reference. */
  monitoredNodeRpcUrl?: string
}
