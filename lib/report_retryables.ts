import axios from 'axios'
import { L1ToL2MessageStatus } from '@arbitrum/sdk'
import { BigNumber, ethers, providers } from 'ethers'
import { ArbGasInfo__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ArbGasInfo__factory'
import {
  ARB_GAS_INFO,
  ARB_RETRYABLE_TX_ADDRESS,
} from '@arbitrum/sdk/dist/lib/dataEntities/constants'
import { ArbRetryableTx__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ArbRetryableTx__factory'
import { Provider } from '@ethersproject/abstract-provider'
import { ChildNetwork } from './find_retryables'
import { slackMessageRetryablesMonitor } from './slack'

export interface L1TicketReport {
  id: string
  transactionHash: string
  sender: string
  retryableTicketID: string
}

export interface L2TicketReport {
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

interface TokenDepositData {
  l2TicketId: string
  tokenAmount: string
  sender: string
  l1Token: {
    symbol: string
    id: string
    decimals: number
  }
}

export const reportFailedTicket = async ({
  parentChainTicketReport,
  childChainTicketReport,
  tokenDepositData,
  childChain,
}: {
  parentChainTicketReport: L1TicketReport
  childChainTicketReport: L2TicketReport
  tokenDepositData: TokenDepositData
  childChain: ChildNetwork
}) => {
  // slack it
  const t = childChainTicketReport
  const now = Math.floor(new Date().getTime() / 1000) // now in s

  // don't report tickets which are not yet scheduled if they have been created in last 2h
  const reportingPeriodForNotScheduled = 2 * 60 * 60 // 2 hours in s
  if (
    t.status == 'NOT_YET_CREATED' &&
    now - +t.createdAtTimestamp < reportingPeriodForNotScheduled
  ) {
    return
  }

  // don't report tickets which expired more than 2 days ago
  const reportingPeriodForExpired = 2 * 24 * 60 * 60 // 2 days in s
  if (
    t.status == 'EXPIRED' &&
    now - +t.timeoutTimestamp > reportingPeriodForExpired
  ) {
    return
  }

  const l1Report = parentChainTicketReport

  const childChainProvider = new providers.JsonRpcProvider(
    String(childChain.orbitRpcUrl)
  )
  const parentChainProvider = new providers.JsonRpcProvider(
    String(childChain.parentRpcUrl)
  )

  // build message to report
  let reportStr =
    formatPrefix(t, childChain.name) +
    (await formatInitiator(tokenDepositData, l1Report)) +
    (await formatDestination(t)) +
    formatL1TX(l1Report) +
    formatId(t) +
    formatL2ExecutionTX(t) +
    (await formatL2Callvalue(t)) +
    (await formatTokenDepositData(tokenDepositData, parentChainProvider)) +
    (await formatGasData(t, childChainProvider)) +
    // (await formatCallData(t)) +
    // (await formatFailureReason(t)) +
    formatCreatedAt(t) +
    formatExpiration(t) +
    '\n================================================================='

  console.log(reportStr)
  try {
    slackMessageRetryablesMonitor(reportStr)
  } catch (e) {
    console.log('Could not send slack message', e)
  }
}

// ALL the util functions copied over from the original file

let ethPriceCache: number
let tokenPriceCache: { [key: string]: number } = {}

const getTimeDifference = (timestampInSeconds: number) => {
  const now = new Date().getTime() / 1000
  const difference = timestampInSeconds - now

  const days = Math.floor(difference / (24 * 60 * 60))
  const hours = Math.floor((difference % (24 * 60 * 60)) / (60 * 60))
  const minutes = Math.floor((difference % (60 * 60)) / 60)
  const seconds = Math.floor(difference % 60)

  if (days > 0) {
    return `${days}days : ${hours}h : ${minutes}min : ${seconds}s`
  } else if (hours > 0) {
    return `${hours}h : ${minutes}min : ${seconds}s`
  } else if (minutes > 0) {
    return `${minutes}min : ${seconds}s`
  } else {
    return `${seconds}s`
  }
}

const formatPrefix = (ticket: L2TicketReport, childChainName: string) => {
  const now = Math.floor(new Date().getTime() / 1000) // now in s

  let prefix
  switch (ticket.status) {
    case L1ToL2MessageStatus[L1ToL2MessageStatus.FUNDS_DEPOSITED_ON_L2]:
      prefix = `*[${childChainName}] Redeem failed for ticket:*`
      break
    case L1ToL2MessageStatus[L1ToL2MessageStatus.EXPIRED]:
      prefix = `*[${childChainName}] Retryable ticket expired:*`
      break
    case L1ToL2MessageStatus[L1ToL2MessageStatus.NOT_YET_CREATED]:
      prefix = `*[${childChainName}] Retryable ticket hasn't been scheduled:*`
      break
    default:
      prefix = `*[${childChainName}] Found retryable ticket in unrecognized state:*`
  }

  // if ticket is about to expire in less than 48h make it a bit dramatic
  if (ticket.status == 'RedeemFailed' || ticket.status == 'Created') {
    const criticalSoonToExpirePeriod = 2 * 24 * 60 * 60 // 2 days in s
    const expiresIn = +ticket.timeoutTimestamp - now
    if (expiresIn < criticalSoonToExpirePeriod) {
      prefix = `🆘📣 ${prefix} 📣🆘`
    }
  }

  return prefix
}

const formatInitiator = async (
  deposit: TokenDepositData | undefined,
  l1Report: L1TicketReport | undefined
) => {
  if (deposit !== undefined) {
    let msg = '\n\t *Deposit initiated by:* '
    // let text = await getContractName(Chain.ETHEREUM, deposit.sender)
    return `${msg}<${deposit.sender}>`
  }

  if (l1Report !== undefined) {
    let msg = '\n\t *Retryable sender:* '
    // let text = await getContractName(Chain.ETHEREUM, l1Report.sender)
    return `${msg}<${l1Report.sender}>`
  }

  return ''
}

const formatId = (ticket: L2TicketReport) => {
  let msg = '\n\t *Child chain ticket creation TX:* '

  if (ticket.id == null) {
    return msg + '-'
  }

  return `${msg}<${ticket.id}|${ticket.id}>`
}

const formatL1TX = (l1Report: L1TicketReport | undefined) => {
  let msg = '\n\t *Parent Chain TX:* '

  if (l1Report == undefined) {
    return msg + '-'
  }

  return `${msg}<${l1Report.transactionHash}|${l1Report.transactionHash}>`
}

const formatL2ExecutionTX = (ticket: L2TicketReport) => {
  let msg = '\n\t *Child chain execution TX:* '

  if (ticket.retryTxHash == null) {
    return msg + '-'
  }

  return `${msg}<${ticket.retryTxHash}|${ticket.retryTxHash}>`
}

const formatL2Callvalue = async (ticket: L2TicketReport) => {
  const ethAmount = ethers.utils.formatEther(ticket.deposit)
  const depositWorthInUsd = (+ethAmount * (await getEthPrice())).toFixed(2)
  return `\n\t *Child chain callvalue:* ${ethAmount} ETH ($${depositWorthInUsd})`
}

const formatTokenDepositData = async (
  deposit: TokenDepositData | undefined,
  parentChainProvider: providers.Provider
) => {
  let msg = '\n\t *Tokens deposited:* '

  if (deposit === undefined) {
    return msg + '-'
  }

  const amount = ethers.utils.formatUnits(
    deposit.tokenAmount,
    deposit.l1Token.decimals
  )

  const tokenPriceInUSD = await getTokenPrice(deposit.l1Token.id)
  if (tokenPriceInUSD !== undefined) {
    const depositWorthInUSD = (+amount * tokenPriceInUSD).toFixed(2)
    msg = `${msg} ${amount} ${deposit.l1Token.symbol} (\$${depositWorthInUSD}) (${deposit.l1Token.id})`
  } else {
    msg = `${msg} ${amount} ${deposit.l1Token.symbol} (${deposit.l1Token.id})`
  }

  return msg
}

const formatDestination = async (ticket: L2TicketReport) => {
  let msg = `\n\t *Destination:* `
  return `${msg}<${ticket.retryTo}>`
}

const formatGasData = async (
  ticket: L2TicketReport,
  childChainProvider: Provider
) => {
  const { l2GasPrice, l2GasPriceAtCreation, redeemEstimate } = await getGasInfo(
    +ticket.createdAtBlockNumber,
    ticket.id,
    childChainProvider
  )

  let msg = `\n\t *Gas params:* `
  msg += `\n\t\t gas price provided: ${ethers.utils.formatUnits(
    ticket.gasFeeCap,
    'gwei'
  )} gwei`
  msg += `\n\t\t gas price at ticket creation block: ${ethers.utils.formatUnits(
    l2GasPriceAtCreation,
    'gwei'
  )} gwei`
  msg += `\n\t\t gas price now: ${ethers.utils.formatUnits(
    l2GasPrice,
    'gwei'
  )} gwei`
  msg += `\n\t\t gas limit provided: ${ticket.gasLimit}`

  if (redeemEstimate) {
    msg += `\n\t\t redeem gas estimate: ${redeemEstimate} `
  } else {
    msg += `\n\t\t redeem gas estimate: estimateGas call reverted`
  }

  return msg
}

const formatCreatedAt = (ticket: L2TicketReport) => {
  return `\n\t *Created at:* ${timestampToDate(+ticket.createdAtTimestamp)}`
}

const formatExpiration = (ticket: L2TicketReport) => {
  let msg = `\n\t *${
    ticket.status == 'Expired' ? `Expired` : `Expires`
  } at:* ${timestampToDate(+ticket.timeoutTimestamp)}`

  if (ticket.status == 'RedeemFailed' || ticket.status == 'Created') {
    msg = `${msg} (that's ${getTimeDifference(
      +ticket.timeoutTimestamp
    )} from now)`
  }

  return msg
}

const getEthPrice = async () => {
  if (ethPriceCache !== undefined) {
    return ethPriceCache
  }

  const url =
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
  const response = await axios.get(url)
  ethPriceCache = +response.data['ethereum'].usd
  return ethPriceCache
}

const getTokenPrice = async (tokenAddress: string) => {
  if (tokenPriceCache[tokenAddress] !== undefined) {
    return tokenPriceCache[tokenAddress]
  }

  const url = `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${tokenAddress}&vs_currencies=usd`

  const response = await axios.get(url)
  if (response.data[tokenAddress] == undefined) {
    return undefined
  }

  tokenPriceCache[tokenAddress] = +response.data[tokenAddress].usd
  return tokenPriceCache[tokenAddress]
}

// Unix timestamp
export const getPastTimestamp = (daysAgoInMs: number) => {
  const now = new Date().getTime()
  return Math.floor((now - daysAgoInMs) / 1000)
}

export const timestampToDate = (timestampInSeconds: number) => {
  const date = new Date(timestampInSeconds * 1000)
  return date.toUTCString()
}

/**
 * Call precompiles to get info about gas price and gas estimation for the TX execution.
 *
 * @param createdAtBlockNumber
 * @param txData
 * @returns
 */
export async function getGasInfo(
  createdAtBlockNumber: number,
  ticketId: string,
  childChainProvider: ethers.providers.Provider
): Promise<{
  l2GasPrice: BigNumber
  l2GasPriceAtCreation: BigNumber
  redeemEstimate: BigNumber | undefined
}> {
  // connect precompiles
  const arbGasInfo = ArbGasInfo__factory.connect(
    ARB_GAS_INFO,
    childChainProvider
  )
  const retryablePrecompile = ArbRetryableTx__factory.connect(
    ARB_RETRYABLE_TX_ADDRESS,
    childChainProvider
  )

  // get current gas price
  const gasComponents = await arbGasInfo.callStatic.getPricesInWei()
  const l2GasPrice = gasComponents[5]

  // get gas price when retryable was created
  const gasComponentsAtCreation = await arbGasInfo.callStatic.getPricesInWei({
    blockTag: createdAtBlockNumber,
  })
  const l2GasPriceAtCreation = gasComponentsAtCreation[5]

  // get gas estimation for redeem
  let redeemEstimate = undefined
  try {
    redeemEstimate = await retryablePrecompile.estimateGas.redeem(ticketId)
  } catch {}

  return { l2GasPrice, l2GasPriceAtCreation, redeemEstimate }
}
