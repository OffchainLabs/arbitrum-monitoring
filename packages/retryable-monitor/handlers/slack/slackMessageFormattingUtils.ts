import axios from 'axios'
import { ParentToChildMessageStatus } from '@arbitrum/sdk'
import { ERC20__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory'
import { BigNumber, ethers } from 'ethers'
import { ArbGasInfo__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ArbGasInfo__factory'
import {
  ARB_GAS_INFO,
  ARB_RETRYABLE_TX_ADDRESS,
} from '@arbitrum/sdk/dist/lib/dataEntities/constants'
import { ArbRetryableTx__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ArbRetryableTx__factory'
import { Provider } from '@ethersproject/abstract-provider'
import {
  ChildChainTicketReport,
  ParentChainTicketReport,
  TokenDepositData,
} from '../../core/types'
import { ChildNetwork, getExplorerUrlPrefixes } from '../../../utils'

/**
 *
 *
 * ALL the `util` functions copied over from the original monitoring repo, edited to fit the L2-L3 types
 * https://github.com/OffchainLabs/arb-monitoring/blob/master/lib/failed_retryables.ts
 *
 *
 */

let ethPriceCache: number
let tokenPriceCache: { [key: string]: number } = {}

export const getTimeDifference = (timestampInSeconds: number) => {
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

export const formatPrefix = (
  ticket: ChildChainTicketReport,
  childChainName: string
) => {
  const now = Math.floor(new Date().getTime() / 1000) // now in s

  let prefix
  switch (ticket.status) {
    case ParentToChildMessageStatus[
      ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD
    ]:
      prefix = `*[${childChainName}] Redeem failed for ticket:*`
      break
    case ParentToChildMessageStatus[ParentToChildMessageStatus.EXPIRED]:
      prefix = `*[${childChainName}] Retryable ticket expired:*`
      break
    case ParentToChildMessageStatus[ParentToChildMessageStatus.NOT_YET_CREATED]:
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

export const formatInitiator = async (
  deposit: TokenDepositData | undefined,
  l1Report: ParentChainTicketReport | undefined,
  childChain: ChildNetwork
) => {
  const { PARENT_CHAIN_ADDRESS_PREFIX } = getExplorerUrlPrefixes(childChain)

  if (deposit !== undefined) {
    let msg = '\n\t *Deposit initiated by:* '
    // let text = await getContractName(Chain.ETHEREUM, deposit.sender)
    return `${msg}<${PARENT_CHAIN_ADDRESS_PREFIX + deposit.sender}|${
      deposit.sender
    }>`
  }

  if (l1Report !== undefined) {
    let msg = '\n\t *Retryable sender:* '
    // let text = await getContractName(Chain.ETHEREUM, l1Report.sender)
    return `${msg}<${PARENT_CHAIN_ADDRESS_PREFIX + l1Report.sender}|${
      l1Report.sender
    }>`
  }

  return ''
}

export const formatId = (
  ticket: ChildChainTicketReport,
  childChain: ChildNetwork
) => {
  let msg = '\n\t *Child chain ticket creation TX:* '

  if (ticket.id == null) {
    return msg + '-'
  }

  const { CHILD_CHAIN_TX_PREFIX } = getExplorerUrlPrefixes(childChain)

  return `${msg}<${CHILD_CHAIN_TX_PREFIX + ticket.id}|${ticket.id}>`
}

export const formatL1TX = (
  l1Report: ParentChainTicketReport | undefined,
  childChain: ChildNetwork
) => {
  let msg = '\n\t *Parent Chain TX:* '

  if (l1Report == undefined) {
    return msg + '-'
  }

  const { PARENT_CHAIN_TX_PREFIX } = getExplorerUrlPrefixes(childChain)

  return `${msg}<${PARENT_CHAIN_TX_PREFIX + l1Report.transactionHash}|${
    l1Report.transactionHash
  }>`
}

export const formatL2ExecutionTX = (
  ticket: ChildChainTicketReport,
  childChain: ChildNetwork
) => {
  let msg = '\n\t *Child chain execution TX:* '

  if (!ticket.retryTxHash) {
    return msg + ': No auto-redeem attempt found'
  }

  const { CHILD_CHAIN_TX_PREFIX } = getExplorerUrlPrefixes(childChain)

  return `${msg}<${CHILD_CHAIN_TX_PREFIX + ticket.retryTxHash}|${
    ticket.retryTxHash
  }>`
}

export const formatL2Callvalue = async (
  ticket: ChildChainTicketReport,
  childChain: ChildNetwork,
  parentChainProvider: Provider
) => {
  if (childChain.nativeToken) {
    const erc20 = ERC20__factory.connect(
      childChain.nativeToken,
      parentChainProvider
    )
    const [symbol, decimals] = await Promise.all([
      erc20.symbol(),
      erc20.decimals(),
    ])

    const nativeTokenAmount = ethers.utils.formatUnits(ticket.deposit, decimals)
    return `\n\t *Child chain callvalue:* ${nativeTokenAmount} ${symbol} (Gas token: ${symbol})`
  } else {
    const ethAmount = ethers.utils.formatEther(ticket.deposit)
    const depositWorthInUsd = (+ethAmount * (await getEthPrice())).toFixed(2)
    return `\n\t *Child chain callvalue:* ${ethAmount} ETH ($${depositWorthInUsd})`
  }
}

export const formatTokenDepositData = async (
  deposit: TokenDepositData | undefined
) => {
  let msg = '\n\t *Tokens deposited:* '

  if (deposit === undefined) {
    return msg + '-'
  }

  const amount = deposit.tokenAmount
    ? ethers.utils.formatUnits(deposit.tokenAmount, deposit.l1Token.decimals)
    : '-'

  const tokenPriceInUSD = await getTokenPrice(deposit.l1Token.id)
  if (tokenPriceInUSD !== undefined) {
    const depositWorthInUSD = (+amount * tokenPriceInUSD).toFixed(2)
    msg = `${msg} ${amount} ${deposit.l1Token.symbol} (\$${depositWorthInUSD}) (${deposit.l1Token.id})`
  } else {
    msg = `${msg} ${amount} ${deposit.l1Token.symbol} (${deposit.l1Token.id})`
  }

  return msg
}

export const formatDestination = async (
  ticket: ChildChainTicketReport,
  childChain: ChildNetwork
) => {
  let msg = `\n\t *Destination:* `
  const { CHILD_CHAIN_ADDRESS_PREFIX } = getExplorerUrlPrefixes(childChain)

  return `${msg}<${CHILD_CHAIN_ADDRESS_PREFIX + ticket.retryTo}|${
    ticket.retryTo
  }>`
}

export const formatGasData = async (
  ticket: ChildChainTicketReport,
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

  if (l2GasPriceAtCreation) {
    msg += `\n\t\t gas price at ticket creation block: ${ethers.utils.formatUnits(
      l2GasPriceAtCreation,
      'gwei'
    )} gwei`
  } else {
    msg += `\n\t\t gas price at ticket creation block: unable to fetch (missing data)`
  }

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

export const formatCreatedAt = (ticket: ChildChainTicketReport) => {
  return `\n\t *Created at:* ${timestampToDate(+ticket.createdAtTimestamp)}`
}

export const formatExpiration = (ticket: ChildChainTicketReport) => {
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

export const getEthPrice = async () => {
  if (ethPriceCache !== undefined) {
    return ethPriceCache
  }

  const url =
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
  const response = await axios.get(url)
  ethPriceCache = +response.data['ethereum'].usd
  return ethPriceCache
}

export const getTokenPrice = async (tokenAddress: string) => {
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
  l2GasPriceAtCreation: BigNumber | undefined
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
  let l2GasPriceAtCreation = undefined
  try {
    const gasComponentsAtCreation = await arbGasInfo.callStatic.getPricesInWei({
      blockTag: createdAtBlockNumber,
    })
    l2GasPriceAtCreation = gasComponentsAtCreation[5]
  } catch {}

  // get gas estimation for redeem
  let redeemEstimate = undefined
  try {
    redeemEstimate = await retryablePrecompile.estimateGas.redeem(ticketId)
  } catch {}

  return { l2GasPrice, l2GasPriceAtCreation, redeemEstimate }
}
