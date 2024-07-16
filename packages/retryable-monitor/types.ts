import { ArbitrumNetwork } from '@arbitrum/sdk'

// Interface defining additional properties for ChildNetwork
export interface ChildNetwork extends ArbitrumNetwork {
  parentRpcUrl: string
  orbitRpcUrl: string
  parentExplorerUrl: string
}

// Type for options passed to findRetryables function
export type FindRetryablesOptions = {
  fromBlock: number
  toBlock: number
  continuous: boolean
  configPath: string
  enableAlerting: boolean
}

export interface ParentChainTicketReport {
  id: string
  transactionHash: string
  sender: string
  retryableTicketID: string
}

export interface ChildChainTicketReport {
  id: string
  retryTxHash: string
  createdAtTimestamp: string
  createdAtBlockNumber: number
  timeoutTimestamp: string
  deposit: string
  status: string
  retryTo: string
  retryData: string
  gasFeeCap: number
  gasLimit: number
}

export interface TokenDepositData {
  l2TicketId: string
  tokenAmount?: string
  sender: string
  l1Token: {
    symbol: string
    id: string
    decimals: number
  }
}
