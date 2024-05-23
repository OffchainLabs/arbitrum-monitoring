// import axios from 'axios'
// import { slackMessageRetryablesMonitor } from './slack'
// import { ethers } from 'ethers'
// import {
//   decodeCalldata,
//   getContractName,
//   getFailureReason,
//   getGasInfo,
// } from './utils'
// import { L1ToL2MessageStatus, L1TransactionReceipt } from '@arbitrum/sdk'

// export interface L1TicketReport {
//   id: string
//   transactionHash: string
//   sender: string
//   retryableTicketID: string
// }

// export interface L2TicketReport {
//   id: string
//   retryTxHash: string
//   createdAtTimestamp: string
//   createdAtBlockNumber: number
//   timeoutTimestamp: string
//   deposit: string
//   status: string
//   retryTo: string
//   retryData: string
//   gasFeeCap: number
//   gasLimit: number
// }

// interface TokenDepositData {
//   l2TicketId: string
//   tokenAmount: string
//   sender: string
//   l1Token: {
//     symbol: string
//     id: string
//     decimals: number
//   }
// }

// export const reportFailedTicket = async (
//   parentChainTicketReport: L1TicketReport,
//   childChainTicketReport: L2TicketReport
// ) => {
//   //   const ticketIDs: string[] = failedTickets.map(t => t.id)

//   //   // get matching L1 TXs from L1 subgraph
//   //   const l1TXsResponse = await querySubgraph(
//   //     l1SubgraphEndpoint,
//   //     GET_L1_TXS_QUERY,
//   //     {
//   //       l2TicketIDs: ticketIDs,
//   //     }
//   //   )
//   //   const l1TXs: L1TicketReport[] = l1TXsResponse['retryables']

//   //   // get token deposit data if Arbitrum token bridge issued the retryable
//   //   const depositsDataResponse = await querySubgraph(
//   //     l1SubgraphEndpoint,
//   //     GET_L1_DEPOSIT_DATA_QUERY,
//   //     {
//   //       l2TicketIDs: ticketIDs,
//   //     }
//   //   )
//   //   const depositsData: TokenDepositData[] = depositsDataResponse['deposits']

//   // slack it
//   const t = childChainTicketReport
//   const now = Math.floor(new Date().getTime() / 1000) // now in s

//   // don't report tickets which are not yet scheduled if they have been created in last 2h
//   const reportingPeriodForNotScheduled = 2 * 60 * 60 // 2 hours in s
//   if (
//     t.status == 'NOT_YET_CREATED' &&
//     now - +t.createdAtTimestamp < reportingPeriodForNotScheduled
//   ) {
//     return
//   }

//   // don't report tickets which expired more than 2 days ago
//   const reportingPeriodForExpired = 2 * 24 * 60 * 60 // 2 days in s
//   if (
//     t.status == 'EXPIRED' &&
//     now - +t.timeoutTimestamp > reportingPeriodForExpired
//   ) {
//     return
//   }

//   const l1Report = parentChainTicketReport
//   const tokenDepositData = undefined

//   // build message to report
//   let reportStr =
//     formatPrefix(t) +
//     (await formatInitiator(tokenDepositData, l1Report)) +
//     (await formatDestination(t)) +
//     formatL1TX(l1Report) +
//     formatId(t) +
//     formatL2ExecutionTX(t) +
//     (await formatL2Callvalue(t)) +
//     (await formatTokenDepositData(tokenDepositData)) +
//     (await formatGasData(t)) +
//     (await formatCallData(t)) +
//     (await formatFailureReason(t)) +
//     formatCreatedAt(t) +
//     formatExpiration(t) +
//     '\n================================================================='

//   slackMessageRetryablesMonitor(reportStr)
// }

// // ALL the util functions copied over from the original file

// let ethPriceCache: number
// let tokenPriceCache: { [key: string]: number } = {}

// const getTimeDifference = (timestampInSeconds: number) => {
//   const now = new Date().getTime() / 1000
//   const difference = timestampInSeconds - now

//   const days = Math.floor(difference / (24 * 60 * 60))
//   const hours = Math.floor((difference % (24 * 60 * 60)) / (60 * 60))
//   const minutes = Math.floor((difference % (60 * 60)) / 60)
//   const seconds = Math.floor(difference % 60)

//   if (days > 0) {
//     return `${days}days : ${hours}h : ${minutes}min : ${seconds}s`
//   } else if (hours > 0) {
//     return `${hours}h : ${minutes}min : ${seconds}s`
//   } else if (minutes > 0) {
//     return `${minutes}min : ${seconds}s`
//   } else {
//     return `${seconds}s`
//   }
// }

// // const isExpired = (ticket: L2TicketReport) => {
// //   const now = Math.floor(new Date().getTime() / 1000) // epoch in seconds
// //   return now > +ticket.timeoutTimestamp
// // }

// // const getFailedTickets = async () => {
// //   const queryResult = await querySubgraph(
// //     l2SubgraphEndpoint,
// //     FAILED_RETRYABLES_QUERY,
// //     {
// //       fromTimestamp: getPastTimestamp(STARTING_TIMESTAMP),
// //     }
// //   )
// //   const failedTickets: L2TicketReport[] = queryResult['retryables']

// //   // subgraph doesn't know about expired tickets, so check and update status here
// //   const failedAndExpiredTickets = failedTickets.map(ticket => {
// //     if (isExpired(ticket)) {
// //       return { ...ticket, status: 'Expired' }
// //     }
// //     return ticket
// //   })

// //   return failedAndExpiredTickets
// // }

// const formatPrefix = (ticket: L2TicketReport) => {
//   const now = Math.floor(new Date().getTime() / 1000) // now in s

//   let prefix
//   switch (ticket.status) {
//     case 'RedeemFailed':
//       prefix = '*[Orbit] Redeem failed for ticket:*'
//       break
//     case 'Expired':
//       prefix = '*[Orbit] Retryable ticket expired:*'
//       break
//     case 'Created':
//       prefix = "*[Orbit] Retryable ticket hasn't been scheduled:*"
//       break
//     default:
//       prefix = '*[Orbit] Found retryable ticket in unrecognized state:*'
//   }

//   // if ticket is about to expire in less than 48h make it a bit dramatic
//   if (ticket.status == 'RedeemFailed' || ticket.status == 'Created') {
//     const criticalSoonToExpirePeriod = 2 * 24 * 60 * 60 // 2 days in s
//     const expiresIn = +ticket.timeoutTimestamp - now
//     if (expiresIn < criticalSoonToExpirePeriod) {
//       prefix = `🆘📣 ${prefix} 📣🆘`
//     }
//   }

//   return prefix
// }

// const formatInitiator = async (
//   deposit: TokenDepositData | undefined,
//   l1Report: L1TicketReport | undefined
// ) => {
//   if (deposit !== undefined) {
//     let msg = '\n\t *Deposit initiated by:* '
//     let text = await getContractName(Chain.ETHEREUM, deposit.sender)

//     return `${msg}<${ETHERSCAN_ADDRESS + deposit.sender}|${text}>`
//   }

//   if (l1Report !== undefined) {
//     let msg = '\n\t *Retryable sender:* '
//     let text = await getContractName(Chain.ETHEREUM, l1Report.sender)

//     return `${msg}<${ETHERSCAN_ADDRESS + l1Report.sender}|${text}>`
//   }

//   return ''
// }

// const formatId = (ticket: L2TicketReport) => {
//   let msg = '\n\t *L2 ticket creation TX:* '

//   if (ticket.id == null) {
//     return msg + '-'
//   }

//   return `${msg}<${ARBISCAN_TX + ticket.id}|${ticket.id}>`
// }

// const formatL1TX = (l1Report: L1TicketReport | undefined) => {
//   let msg = '\n\t *L1 TX:* '

//   if (l1Report == undefined) {
//     return msg + '-'
//   }

//   return `${msg}<${ETHERSCAN_TX + l1Report.transactionHash}|${
//     l1Report.transactionHash
//   }>`
// }

// const formatL2ExecutionTX = (ticket: L2TicketReport) => {
//   let msg = '\n\t *L2 execution TX:* '

//   if (ticket.retryTxHash == null) {
//     return msg + '-'
//   }

//   return `${msg}<${ARBISCAN_TX + ticket.retryTxHash}|${ticket.retryTxHash}>`
// }

// const formatL2Callvalue = async (ticket: L2TicketReport) => {
//   const ethAmount = ethers.utils.formatEther(ticket.deposit)
//   const depositWorthInUsd = (+ethAmount * (await getEthPrice())).toFixed(2)
//   return `\n\t *L2 callvalue:* ${ethAmount} ETH ($${depositWorthInUsd})`
// }

// const formatTokenDepositData = async (
//   deposit: TokenDepositData | undefined
// ) => {
//   let msg = '\n\t *Tokens deposited:* '

//   if (deposit === undefined) {
//     return msg + '-'
//   }

//   const amount = ethers.utils.formatUnits(
//     deposit.tokenAmount,
//     deposit.l1Token.decimals
//   )
//   const tokenPriceInUSD = await getTokenPrice(deposit.l1Token.id)
//   if (tokenPriceInUSD !== undefined) {
//     const depositWorthInUSD = (+amount * tokenPriceInUSD).toFixed(2)
//     msg = `${msg} ${amount} ${deposit.l1Token.symbol} (\$${depositWorthInUSD}) (${deposit.l1Token.id})`
//   }

//   return msg
// }

// const formatDestination = async (ticket: L2TicketReport) => {
//   //   let msg = `\n\t *Destination:* `
//   //   let text = await getContractName(Chain.ARBITRUM, ticket.retryTo)

//   //   return `${msg}<${ARBISCAN_ADDRESS + ticket.retryTo}|${text}>`

//   let msg = `\n\t *Destination:* `
//   return `${msg}<${ticket.retryTo}>`
// }

// const formatGasData = async (ticket: L2TicketReport) => {
//   const { l2GasPrice, l2GasPriceAtCreation, redeemEstimate } = await getGasInfo(
//     +ticket.createdAtBlockNumber,
//     ticket.id
//   )

//   let msg = `\n\t *Gas params:* `
//   msg += `\n\t\t gas price provided: ${ethers.utils.formatUnits(
//     ticket.gasFeeCap,
//     'gwei'
//   )} gwei`
//   msg += `\n\t\t gas price at ticket creation block: ${ethers.utils.formatUnits(
//     l2GasPriceAtCreation,
//     'gwei'
//   )} gwei`
//   msg += `\n\t\t gas price now: ${ethers.utils.formatUnits(
//     l2GasPrice,
//     'gwei'
//   )} gwei`
//   msg += `\n\t\t gas limit provided: ${ticket.gasLimit}`

//   if (redeemEstimate) {
//     msg += `\n\t\t redeem gas estimate: ${redeemEstimate} `
//   } else {
//     msg += `\n\t\t redeem gas estimate: estimateGas call reverted`
//   }

//   return msg
// }

// const formatCallData = async (ticket: L2TicketReport) => {
//   const functionName = await decodeCalldata(ticket.retryData, ticket.retryTo)
//   if (functionName === undefined) {
//     return ''
//   }

//   return `\n\t *Decoded calldata:* ${functionName}`
// }

// export async function formatFailureReason(
//   ticket: L2TicketReport
// ): Promise<string> {
//   if (ticket.retryTxHash == null) {
//     return ''
//   }

//   const failureReason = await getFailureReason(ticket.retryTxHash)

//   if (failureReason === undefined) {
//     return ''
//   }

//   return `\n\t *Failure reason:* ${failureReason}`
// }

// const formatCreatedAt = (ticket: L2TicketReport) => {
//   return `\n\t *Created at:* ${timestampToDate(+ticket.createdAtTimestamp)}`
// }

// const formatExpiration = (ticket: L2TicketReport) => {
//   let msg = `\n\t *${
//     ticket.status == 'Expired' ? `Expired` : `Expires`
//   } at:* ${timestampToDate(+ticket.timeoutTimestamp)}`

//   if (ticket.status == 'RedeemFailed' || ticket.status == 'Created') {
//     msg = `${msg} (that's ${getTimeDifference(
//       +ticket.timeoutTimestamp
//     )} from now)`
//   }

//   return msg
// }

// const getEthPrice = async () => {
//   if (ethPriceCache !== undefined) {
//     return ethPriceCache
//   }

//   const url =
//     'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
//   const response = await axios.get(url)
//   ethPriceCache = +response.data['ethereum'].usd
//   return ethPriceCache
// }

// const getTokenPrice = async (tokenAddress: string) => {
//   if (tokenPriceCache[tokenAddress] !== undefined) {
//     return tokenPriceCache[tokenAddress]
//   }

//   const url = `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${tokenAddress}&vs_currencies=usd`

//   const response = await axios.get(url)
//   if (response.data[tokenAddress] == undefined) {
//     return undefined
//   }

//   tokenPriceCache[tokenAddress] = +response.data[tokenAddress].usd
//   return tokenPriceCache[tokenAddress]
// }

// // Unix timestamp
// export const getPastTimestamp = (daysAgoInMs: number) => {
//   const now = new Date().getTime()
//   return Math.floor((now - daysAgoInMs) / 1000)
// }

// export const timestampToDate = (timestampInSeconds: number) => {
//   const date = new Date(timestampInSeconds * 1000)
//   return date.toUTCString()
// }
