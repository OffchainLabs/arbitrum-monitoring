import { providers } from 'ethers'
import { ChildNetwork } from '../../utils'
import {
  ChildChainTicketReport,
  ParentChainTicketReport,
  TokenDepositData,
} from '../core/types'
import {
  formatPrefix,
  formatInitiator,
  formatDestination,
  formatL1TX,
  formatId,
  formatL2ExecutionTX,
  formatL2Callvalue,
  formatTokenDepositData,
  formatGasData,
  formatCreatedAt,
  formatExpiration,
} from './slackMessageFormattingUtils'

export const generateFailedRetryableSlackMessage = async ({
  parentChainRetryableReport,
  childChainRetryableReport,
  tokenDepositData,
  childChain,
  parentChainProvider,
  childChainProvider,
}: {
  parentChainRetryableReport: ParentChainTicketReport
  childChainRetryableReport: ChildChainTicketReport
  tokenDepositData?: TokenDepositData
  childChain: ChildNetwork
  parentChainProvider: providers.Provider
  childChainProvider: providers.Provider
}): Promise<string> => {
  const t = childChainRetryableReport
  const l1Report = parentChainRetryableReport

  // build message to report
  return (
    formatPrefix(t, childChain.name) +
    (await formatInitiator(tokenDepositData, l1Report, childChain)) +
    (await formatDestination(t, childChain)) +
    formatL1TX(l1Report, childChain) +
    formatId(t, childChain) +
    formatL2ExecutionTX(t, childChain) +
    (await formatL2Callvalue(t, childChain, parentChainProvider)) +
    (await formatTokenDepositData(tokenDepositData)) +
    (await formatGasData(t, childChainProvider)) +
    formatCreatedAt(t) +
    formatExpiration(t) +
    '\n================================================================='
  )
}
