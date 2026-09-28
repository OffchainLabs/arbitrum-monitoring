import { ArbitrumNetwork } from '@arbitrum/sdk'

// Interface defining additional properties for ChildNetwork
export interface ChildNetwork extends ArbitrumNetwork {
  parentRpcUrl: string
  orbitRpcUrl: string
  explorerUrl: string
  parentExplorerUrl: string
  /** Operator-run nodes to health-check with node-sync-monitor. Requires referenceRpcUrl. */
  monitoredNodeRpcUrls?: string[]
  /** Trusted RPC that node-sync-monitor compares the monitored nodes against; must be on infrastructure independent of the monitored nodes. */
  referenceRpcUrl?: string
}
