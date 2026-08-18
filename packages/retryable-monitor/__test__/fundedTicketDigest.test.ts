import { describe, expect, test, vi, beforeEach } from 'vitest'
import { ChildNetwork } from 'utils'
import {
  ChildChainTicketReport,
  OnFailedRetryableFoundParams,
  ParentChainTicketReport,
} from '../core/types'

vi.mock('../handlers/slack/postSlackMessage', () => ({
  postSlackMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../handlers/slack/slackMessageGenerator', () => ({
  generateFailedRetryableSlackMessage: vi
    .fn()
    .mockResolvedValue('detailed per-ticket alert'),
}))

vi.mock('@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory', () => ({
  ERC20__factory: {
    connect: vi.fn(() => ({
      symbol: async () => 'XAI',
      decimals: async () => 6,
    })),
  },
}))

vi.mock('../handlers/slack/slackMessageFormattingUtils', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../handlers/slack/slackMessageFormattingUtils')
  >()),
  getEthPrice: vi.fn().mockResolvedValue(2000),
}))

import {
  addTicketToFundedDigest,
  buildFundedDigestMessage,
  postFundedTicketAlerts,
  MAX_INDIVIDUAL_FUNDED_ALERTS,
} from '../handlers/fundedTicketDigest'
import { postSlackMessage } from '../handlers/slack/postSlackMessage'
import { generateFailedRetryableSlackMessage } from '../handlers/slack/slackMessageGenerator'

const nowInSeconds = Math.floor(Date.now() / 1000)

const childChain = {
  name: 'Test Chain',
  chainId: 12345,
  orbitRpcUrl: 'http://localhost:1',
  parentRpcUrl: 'http://localhost:2',
  explorerUrl: 'https://child.explorer/',
  parentExplorerUrl: 'https://parent.explorer/',
} as ChildNetwork

const buildTicket = ({
  id = '0xticket',
  l2CallValue = '100000000000000000', // 0.1 ETH
  sender = '0xsender',
  destination = '0xdest',
  timeoutTimestamp = String(nowInSeconds + 6 * 24 * 60 * 60),
  tokenAmount,
}: {
  id?: string
  l2CallValue?: string
  sender?: string
  destination?: string
  timeoutTimestamp?: string
  tokenAmount?: string
} = {}): OnFailedRetryableFoundParams => ({
  parentChainRetryableReport: {
    id: '0xparenttx',
    transactionHash: '0xparenttx',
    sender,
    retryableTicketID: id,
  } as ParentChainTicketReport,
  childChainRetryableReport: {
    id,
    createdAtTimestamp: String(nowInSeconds - 60 * 60),
    createdAtBlockNumber: 1,
    timeoutTimestamp,
    deposit: l2CallValue,
    status: 'FUNDS_DEPOSITED_ON_CHILD',
    retryTo: destination,
    retryData: '0x',
    gasFeeCap: 0,
    gasLimit: 0,
    l2CallValue,
  } as ChildChainTicketReport,
  tokenDepositData: tokenAmount
    ? {
        l2TicketId: id,
        tokenAmount,
        sender,
        l1Token: { symbol: 'TST', decimals: 18, id: '0xtoken' },
      }
    : undefined,
  childChain,
})

describe('postFundedTicketAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('posts detailed per-ticket alerts for small batches', async () => {
    for (let i = 0; i < MAX_INDIVIDUAL_FUNDED_ALERTS; i++) {
      addTicketToFundedDigest(buildTicket({ id: `0xticket${i}` }))
    }

    await postFundedTicketAlerts(childChain)

    expect(generateFailedRetryableSlackMessage).toHaveBeenCalledTimes(
      MAX_INDIVIDUAL_FUNDED_ALERTS
    )
    expect(postSlackMessage).toHaveBeenCalledTimes(MAX_INDIVIDUAL_FUNDED_ALERTS)
    expect(postSlackMessage).toHaveBeenCalledWith({
      message: 'detailed per-ticket alert',
    })
  })

  test('posts a single digest for batches above the threshold', async () => {
    for (let i = 0; i <= MAX_INDIVIDUAL_FUNDED_ALERTS; i++) {
      addTicketToFundedDigest(buildTicket({ id: `0xticket${i}` }))
    }

    await postFundedTicketAlerts(childChain)

    expect(generateFailedRetryableSlackMessage).not.toHaveBeenCalled()
    expect(postSlackMessage).toHaveBeenCalledTimes(1)
    const message = (postSlackMessage as any).mock.calls[0][0].message
    expect(message).toContain(
      `URGENT: ${MAX_INDIVIDUAL_FUNDED_ALERTS + 1} unredeemed retryables with funds at risk`
    )
    expect(message).toContain(
      `Sending a summary instead of individual alerts to avoid spam, since the ticket count exceeds ${MAX_INDIVIDUAL_FUNDED_ALERTS}`
    )
  })

  test('flush clears the buffer', async () => {
    for (let i = 0; i < 3; i++) {
      addTicketToFundedDigest(buildTicket({ id: `0xticket${i}` }))
    }
    await postFundedTicketAlerts(childChain)
    vi.clearAllMocks()

    await postFundedTicketAlerts(childChain)

    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  test('no-ops for chains without funded tickets', async () => {
    await postFundedTicketAlerts(childChain)
    expect(postSlackMessage).not.toHaveBeenCalled()
  })
})

describe('buildFundedDigestMessage', () => {
  test('summarizes totals, average, largest, senders, destinations and status', async () => {
    const tickets = [
      buildTicket({ id: '0xaaa', l2CallValue: '100000000000000000' }),
      buildTicket({
        id: '0xbbb',
        l2CallValue: '300000000000000000',
        sender: '0xothersender',
        destination: '0xotherdest',
      }),
    ]

    const message = await buildFundedDigestMessage(childChain, tickets)

    expect(message).toContain('*Total unredeemed:* 0.4 ETH (~$800.00)')
    expect(message).toContain('*Average per ticket:* 0.2 ETH (~$400.00)')
    expect(message).toContain('*Largest:* 0.3 ETH (~$600.00)')
    expect(message).toContain('created but not redeemed: 2')
    expect(message).toContain('0xsender: 1')
    expect(message).toContain('0xothersender: 1')
    expect(message).toContain('*Distinct destinations:* 2')
    expect(message).toContain('https://child.explorer/tx/0xaaa')
  })

  test('reports the expiry window with a countdown', async () => {
    const earliest = nowInSeconds + 2 * 24 * 60 * 60 + 60
    const latest = nowInSeconds + 6 * 24 * 60 * 60 + 60
    const tickets = [
      buildTicket({ id: '0xaaa', timeoutTimestamp: String(earliest) }),
      buildTicket({ id: '0xbbb', timeoutTimestamp: String(latest) }),
    ]

    const message = await buildFundedDigestMessage(childChain, tickets)

    expect(message).toContain(
      `earliest ${new Date(earliest * 1000).toUTCString()} (in 2d 0h)`
    )
    expect(message).toContain(
      `latest ${new Date(latest * 1000).toUTCString()} (in 6d 0h)`
    )
  })

  test('points to the GitHub Actions artifact when running in CI', async () => {
    process.env.GITHUB_REPOSITORY = 'OffchainLabs/arbitrum-monitoring'
    process.env.GITHUB_RUN_ID = '12345'
    try {
      const message = await buildFundedDigestMessage(childChain, [buildTicket()])
      expect(message).toContain(
        'check the *retryable-run-report.json* artifact on <https://github.com/OffchainLabs/arbitrum-monitoring/actions/runs/12345|this run> urgently'
      )
    } finally {
      delete process.env.GITHUB_REPOSITORY
      delete process.env.GITHUB_RUN_ID
    }
  })

  test('marks tickets that also carry token deposits', async () => {
    const tickets = [
      buildTicket({ id: '0xtok', tokenAmount: '1000' }),
      buildTicket({ id: '0xeth' }),
    ]

    const message = await buildFundedDigestMessage(childChain, tickets)

    expect(message).toContain('(+1 ticket with token deposits)')
    expect(message).toContain('0xtok> — 0.1 ETH + tokens')
  })

  test('caps the listed tickets and reports the overflow count', async () => {
    const tickets = Array.from({ length: 25 }, (_, i) =>
      buildTicket({ id: `0xticket${i}` })
    )

    const message = await buildFundedDigestMessage(childChain, tickets)

    expect(message).toContain('25 unredeemed retryables')
    expect(message).toContain('0xticket9>')
    expect(message).not.toContain('0xticket10>')
    expect(message).toContain('…and 15 more')
  })

  test('shortens long ticket ids and stays under the Slack split threshold', async () => {
    const mkId = (i: number) =>
      '0x' + String(i).padStart(2, '0').repeat(32) // realistic 66-char ids
    const tickets = Array.from({ length: 55 }, (_, i) =>
      buildTicket({ id: mkId(i) })
    )

    const message = await buildFundedDigestMessage(childChain, tickets)

    expect(message).toContain(`|0x000000…000000>`)
    expect(message).toContain(`${mkId(0)}|`) // full URL still present in the link
    expect(message.length).toBeLessThan(4000)
  })

  test('skips USD conversion on custom gas-token chains', async () => {
    const gasTokenChain = {
      ...childChain,
      nativeToken: '0xgastoken',
    } as ChildNetwork

    const message = await buildFundedDigestMessage(gasTokenChain, [
      buildTicket(),
    ])

    expect(message).toContain('*Total unredeemed:* 0.1 gas tokens')
    expect(message).not.toContain('$')
  })

  test('uses the gas token symbol and decimals when a parent provider is available', async () => {
    const gasTokenChain = {
      ...childChain,
      nativeToken: '0xgastoken',
    } as ChildNetwork

    const message = await buildFundedDigestMessage(
      gasTokenChain,
      [buildTicket({ l2CallValue: '2500000' })], // 2.5 with the token's 6 decimals
      {} as any
    )

    expect(message).toContain('*Total unredeemed:* 2.5 XAI')
    expect(message).toContain('— 2.5 XAI —')
    expect(message).not.toContain('$')
  })
})
