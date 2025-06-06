import { ChildNetwork } from '../../utils'
import { providers } from 'ethers'

// Type for options passed to findRetryables function
export interface FindRetryablesOptions {
  fromBlock: number
  toBlock: number
  continuous: boolean
  configPath: string
  enableAlerting: boolean
  writeToNotion: boolean
}

export interface CheckRetryablesOneOffParams {
  parentChainProvider: providers.Provider
  childChainProvider: providers.Provider
  childChain: ChildNetwork
  fromBlock: number
  toBlock: number
  enableAlerting: boolean
  onFailedRetryableFound: OnFailedRetryableFound
  onRedeemedRetryableFound: OnRedeemedRetryableFound
}

export interface CheckRetryablesContinuousParams
  extends CheckRetryablesOneOffParams {
  continuous: boolean
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

export interface OnRetryableFoundParams {
  ChildTx: string
  ParentTx: string
  createdAt: number
  timeout?: number
  status:string
  priority?: 'High' | 'Medium' | 'Low' | 'Unset'
  decision?: string
  metadata?: {
    tokensDeposited?: string
    gasPriceProvided: string
    gasPriceAtCreation?: string
    gasPriceNow: string
    l2CallValue: string
    createdAt?: number
    decision?: string
    
  }
}

export interface OnFailedRetryableFoundParams {
  parentChainRetryableReport: ParentChainTicketReport
  childChainRetryableReport: ChildChainTicketReport
  tokenDepositData?: TokenDepositData
  childChain: ChildNetwork
}

export type OnFailedRetryableFound = (
  params: OnFailedRetryableFoundParams
) => Promise<void>

export type OnRedeemedRetryableFound = (
  params: OnRetryableFoundParams
) => Promise<void>
