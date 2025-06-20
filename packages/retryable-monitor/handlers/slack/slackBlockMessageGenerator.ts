import { providers } from 'ethers'
import { ParentToChildMessageStatus } from '@arbitrum/sdk'
import { ERC20__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory'
import { ChildNetwork } from '../../../utils'
import {
  ChildChainTicketReport,
  ParentChainTicketReport,
  TokenDepositData,
} from '../../core/types'
import axios from 'axios'
import { ethers } from 'ethers'

type Priority = 'Critical' | 'High' | 'Medium' | 'Low'

let ethPriceCache: number
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
const calculatePriority = (valueUsd: number, hoursLeft: number): Priority => {
  if (valueUsd >= 1000 || hoursLeft < 2) return 'Critical'
  if (valueUsd >= 100 || hoursLeft < 24) return 'High'
  if (hoursLeft < 72) return 'Medium'
  return 'Low'
}

const getSimpleState = (status: string): string => {
  switch (status) {
    case ParentToChildMessageStatus[ParentToChildMessageStatus.NOT_YET_CREATED]:
      return 'Pending'
    case ParentToChildMessageStatus[
      ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD
    ]:
      return 'Failed'
    case ParentToChildMessageStatus[ParentToChildMessageStatus.EXPIRED]:
      return 'Expired'
    default:
      return 'Unknown'
  }
}

const formatTimeLeft = (timestampInSeconds: number): string => {
  const now = Math.floor(Date.now() / 1000)
  const diff = timestampInSeconds - now

  if (diff <= 0) return 'Expired'

  const hours = Math.floor(diff / 3600)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h`
  return '<1h'
}

export const generateRetryableSlackBlocks = async ({
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
}): Promise<any[]> => {
  const ticket = childChainRetryableReport

  let valueText = ''
  let valueUsd = 0

  if (childChain.nativeToken) {
    const erc20 = ERC20__factory.connect(
      childChain.nativeToken,
      parentChainProvider
    )
    const [symbol, decimals] = await Promise.all([
      erc20.symbol(),
      erc20.decimals(),
    ])
    const amount = ethers.utils.formatUnits(ticket.deposit, decimals)
    valueText = `${parseFloat(amount).toFixed(4)} ${symbol}`
  } else {
    const ethAmount = ethers.utils.formatEther(ticket.deposit)
    const ethPrice = await getEthPrice()
    valueUsd = +ethAmount * ethPrice
    valueText = `${parseFloat(ethAmount).toFixed(4)} ETH`
  }

  if (tokenDepositData?.tokenAmount && tokenDepositData?.l1Token) {
    const amount = ethers.utils.formatUnits(
      tokenDepositData.tokenAmount,
      tokenDepositData.l1Token.decimals
    )
    valueText += ` + ${parseFloat(amount).toFixed(2)} ${
      tokenDepositData.l1Token.symbol
    }`
  }

  const now = Math.floor(Date.now() / 1000)
  const hoursLeft = (+ticket.timeoutTimestamp - now) / 3600
  const priority = calculatePriority(valueUsd, hoursLeft)
  const state = getSimpleState(ticket.status)
  const timeLeft = formatTimeLeft(+ticket.timeoutTimestamp)
  const ticketId = ticket.id.slice(-8).toUpperCase()

  const priorityEmoji = {
    Critical: '🚨',
    High: '🔥',
    Medium: '⚠️',
    Low: '💡',
  }[priority]

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${priorityEmoji} Retryable Alert`,
      },
    },

    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Ticket*\n\`${ticketId}\`\n\u00A0`,
        },
        {
          type: 'mrkdwn',
          text: `*Priority*\n${priority}\n\u00A0`,
        },
        {
          type: 'mrkdwn',
          text: `*State*\n${state}\n\u00A0`,
        },
        {
          type: 'mrkdwn',
          text: `*Value*\n${valueText}\n\u00A0`,
        },
        {
          type: 'mrkdwn',
          text: `*Network*\n${childChain.name}\n\u00A0`,
        },
        {
          type: 'mrkdwn',
          text: `*Time Left*\n${timeLeft}\n\u00A0`,
        },
      ],
    },
  ]

  const actionElements: any[] = []

  if (hoursLeft > 0) {
    if (state === 'Pending') {
      actionElements.push({
        type: 'button',
        action_id: 'redeem_now',
        text: { type: 'plain_text', text: 'Redeem now' },
        value: ticketId,
        style: 'primary',
      })
    } else if (state === 'Failed') {
      actionElements.push({
        type: 'button',
        action_id: 'retry_redeem',
        text: { type: 'plain_text', text: 'Retry redeem' },
        value: ticketId,
        style: 'primary',
      })
    }
  }

  actionElements.push({
    type: 'button',
    text: { type: 'plain_text', text: 'Open dashboard' },
    url: `https://retryable-dashboard.arbitrum.io/tx/${ticket.id}`,
    action_id: 'open_dashboard',
  })

  actionElements.push({
    type: 'overflow',
    action_id: `overflow_${ticketId}`,
    options: [
      {
        text: { type: 'plain_text', text: 'Parent transaction' },
        value: `parent_tx_${ticketId}`,
        url: `https://etherscan.io/tx/${parentChainRetryableReport.transactionHash}`,
      },
      {
        text: { type: 'plain_text', text: 'Child transaction' },
        value: `child_tx_${ticketId}`,
        url: `https://arbiscan.io/tx/${ticket.id}`,
      },
      {
        text: { type: 'plain_text', text: 'GitHub CI run' },
        value: `github_ci_${ticketId}`,
        url: 'https://github.com/OffchainLabs/arbitrum-monitoring/actions',
      },
    ],
  })

  if (actionElements.length > 0) {
    blocks.push({
      type: 'actions',
      elements: actionElements,
    })
  }

  return blocks
}
