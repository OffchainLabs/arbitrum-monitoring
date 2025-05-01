import { ChildNetwork } from '../../utils'

// Type for options passed to findRetryables function
export interface FindRetryablesOptions {
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
  retryTxHash?: string
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
    decimals: number
    id: string
  }
}

export type OnFailedRetryableFound = (params: {
  parentChainRetryableReport: ParentChainTicketReport
  childChainRetryableReport: ChildChainTicketReport
  tokenDepositData?: TokenDepositData
  childChain: ChildNetwork
}) => Promise<void>
