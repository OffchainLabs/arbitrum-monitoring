import { ArbitrumNetwork } from '@arbitrum/sdk'

// Interface defining additional properties for ChildNetwork
export interface ChildNetwork extends ArbitrumNetwork {
  parentRpcUrl: string
  orbitRpcUrl: string
  explorerUrl: string
  parentExplorerUrl: string
  /** Operator-run node to health-check with node-sync-monitor. Requires referenceRpcUrl. */
  monitoredNodeRpcUrl?: string
  /** Trusted RPC that node-sync-monitor compares the monitored node against; must be on infrastructure independent of the monitored node. */
  referenceRpcUrl?: string
}
