import { L2Network as ParentNetwork } from '@arbitrum/sdk'

// Interface defining additional properties for ChildNetwork
export interface ChildNetwork extends ParentNetwork {
  parentRpcUrl: string
  orbitRpcUrl: string
  parentExplorerUrl: string
}
