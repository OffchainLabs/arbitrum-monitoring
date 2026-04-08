import { describe, expect, test, vi } from 'vitest'
import { BigNumber, providers, utils } from 'ethers'
import type { ParentTransactionReceipt } from '@arbitrum/sdk'
import type { ParentToChildMessageReader } from '@arbitrum/sdk'

vi.mock('@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory', () => ({
  ERC20__factory: {
    connect: vi.fn(() => ({
      symbol: () => Promise.resolve('DF'),
      decimals: () => Promise.resolve(18),
    })),
  },
}))

import { getTokenDepositData } from '../core/tokenDataFetcher'

/**
 * https://etherscan.io/tx/0xbe10d729a50d8a485e7c3285b309d98c1dc853cb760aa5c33fca73b98a7f23dd
 * (DF deposit via L1 Gateway Router -> custom gateway)
 */
const PARENT_TX =
  '0xbe10d729a50d8a485e7c3285b309d98c1dc853cb760aa5c33fca73b98a7f23dd'
const SENDER = '0x6C4A72eC1DD4fBE90E7E23c6C9187262D59345BB'
const DF_TOKEN = '0x431ad2ff6a9c365805ebad47ee021148d6f7dbe0'
const CUSTOM_GATEWAY = '0xcee284f754e854890e311e3280b767f80797180d'
const AMOUNT_RAW = '299911000000000000000000'
const SEQUENCE_TOPIC =
  '0x000000000000000000000000000000000000000000000000000000000023498c'

const ERC20_TRANSFER_TOPIC = utils.id('Transfer(address,address,uint256)')

function padAddress(addr: string) {
  return utils.hexZeroPad(addr.toLowerCase(), 32)
}

function buildDfTransferLog(): providers.Log {
  return {
    blockNumber: 1,
    blockHash: '0x' + '0'.repeat(64),
    transactionIndex: 0,
    removed: false,
    address: DF_TOKEN,
    data: utils.defaultAbiCoder.encode(
      ['uint256'],
      [BigNumber.from(AMOUNT_RAW)]
    ),
    topics: [
      ERC20_TRANSFER_TOPIC,
      padAddress(SENDER),
      padAddress(CUSTOM_GATEWAY),
    ],
    transactionHash: PARENT_TX,
    logIndex: 1,
  }
}

function buildDepositInitiatedFetchedEvent() {
  return {
    event: [
      DF_TOKEN,
      SENDER,
      SENDER,
      BigNumber.from('0x23498c'),
      BigNumber.from(AMOUNT_RAW),
    ] as [string, string, string, BigNumber, BigNumber],
    topic: '',
    name: 'DepositInitiated',
    blockNumber: 1,
    blockHash: '0x' + '1'.repeat(64),
    transactionHash: PARENT_TX,
    address: CUSTOM_GATEWAY,
    topics: [
      utils.id(
        'DepositInitiated(address,address,address,uint256,uint256)'
      ) as string,
      padAddress(SENDER),
      padAddress(SENDER),
      SEQUENCE_TOPIC,
    ],
    data: utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [DF_TOKEN, BigNumber.from(AMOUNT_RAW)]
    ),
  }
}

describe('getTokenDepositData', () => {
  const l2TicketId =
    '0x34ef407c8b59833011aef7eb3f06f086fa24f357f351c6f67ba14b8530dc7c6f'

  const gatewayAddresses = [
    '0x0000000000000000000000000000000000000001',
    CUSTOM_GATEWAY,
    '0x0000000000000000000000000000000000000002',
  ]

  const arbParentTxReceipt = {
    transactionHash: PARENT_TX,
    from: SENDER,
  } as ParentTransactionReceipt

  const retryableMessage = {
    retryableCreationId: l2TicketId,
  } as ParentToChildMessageReader

  const parentChainProvider = {} as providers.Provider

  test('known parent tx: DepositInitiated + matching ERC20 transfer resolves token and amount', async () => {
    const requestIdBody =
      '000000000000000000000000000000000000000000000000000000000023498c'
    const childChainTx = {
      data: `0xabc9f95d32${requestIdBody}00`,
    } as providers.TransactionResponse

    const parentTxReceipt = {
      logs: [buildDfTransferLog()],
    } as providers.TransactionReceipt

    const result = await getTokenDepositData({
      childChainTx,
      retryableMessage,
      parentTxReceipt,
      arbParentTxReceipt,
      depositsInitiatedLogs: [buildDepositInitiatedFetchedEvent()] as any,
      gatewayAddresses,
      parentChainProvider,
    })

    expect(result).toBeDefined()
    expect(result!.l1Token.id.toLowerCase()).toBe(DF_TOKEN.toLowerCase())
    expect(result!.tokenAmount).toBe(AMOUNT_RAW)
    expect(result!.l1Token.symbol).toBe('DF')
    expect(result!.l1Token.decimals).toBe(18)
    expect(result!.l2TicketId).toBe(l2TicketId)
  })

  test('transfer-only: no DepositInitiated logs still resolves from sender->gateway transfer', async () => {
    const childChainTx = {
      data: '0x',
    } as providers.TransactionResponse

    const parentTxReceipt = {
      logs: [buildDfTransferLog()],
    } as providers.TransactionReceipt

    const result = await getTokenDepositData({
      childChainTx,
      retryableMessage,
      parentTxReceipt,
      arbParentTxReceipt,
      depositsInitiatedLogs: [],
      gatewayAddresses,
      parentChainProvider,
    })

    expect(result).toBeDefined()
    expect(result!.l1Token.id.toLowerCase()).toBe(DF_TOKEN.toLowerCase())
    expect(result!.tokenAmount).toBe(AMOUNT_RAW)
  })
})
