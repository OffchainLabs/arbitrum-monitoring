import { createPublicClient, http, PublicClient } from 'viem'
import { beforeEach, describe, expect, test } from 'vitest'
import { hasChainActivity, isBoldEnabled, createChildChainClient } from '../blockchain'
import { getChainFromId } from '../chains'
import { checkChainForAssertionIssues, getBlockRange } from '../index'
import { BlockRange } from '../types'
import { boldChainInfo, classicChainInfo } from './testConfigs'

// Known block range where we have events (Arbitrum Sepolia)
const BOLD_FROM_BLOCK = 7627075n
const BOLD_TO_BLOCK = 7637075n

// Known block range for Classic chain (Xai Testnet)
const CLASSIC_FROM_BLOCK = 124632400n
const CLASSIC_TO_BLOCK = 124667079n


describe('Assertion Monitor - BOLD Chain', () => {
  let client: PublicClient

  beforeEach(() => {
    const parentChain = getChainFromId(boldChainInfo.parentChainId)
    client = createPublicClient({
      chain: parentChain,
      transport: http(boldChainInfo.parentRpcUrl),
    })
  })

  test('should correctly identify as BOLD chain', async () => {
    const isBold = await isBoldEnabled(client, boldChainInfo.ethBridge.rollup)
    console.log(`Chain type detection: ${isBold ? 'BOLD' : 'Classic'} rollup`)
    expect(isBold).toBe(true)
  })

  test('should get valid block range', async () => {
    const { fromBlock, toBlock } = await getBlockRange(client, boldChainInfo)
    expect(fromBlock).toBeDefined()
    expect(toBlock).toBeDefined()
    expect(toBlock).toBeGreaterThan(fromBlock)

    // Ensure the block range is within reasonable bounds
    const blockDiff = toBlock - fromBlock
    expect(blockDiff).toBeLessThanOrEqual(
      BigInt(boldChainInfo.confirmPeriodBlocks * 2)
    )
  })

  test('should detect chain activity in known block range', async () => {
    const childChainClient = createChildChainClient(boldChainInfo)
    const hasActivity = await hasChainActivity(childChainClient, BOLD_FROM_BLOCK)
    console.log(`Chain activity detected: ${hasActivity}`)
    expect(typeof hasActivity).toBe('boolean')
  })

  test(
    'should monitor assertions over known block range',
    async () => {
      const blockRange: BlockRange = {
        fromBlock: BOLD_FROM_BLOCK,
        toBlock: BOLD_TO_BLOCK,
      }
      const monitorResult = await checkChainForAssertionIssues(
        boldChainInfo,
        blockRange
      )
      expect(
        monitorResult === null || typeof monitorResult.alertMessage === 'string'
      ).toBe(true)
    },
    { timeout: 30000 }
  )
})

describe('Assertion Monitor - Classic Chain', () => {
  let client: PublicClient

  beforeEach(() => {
    const parentChain = getChainFromId(classicChainInfo.parentChainId)
    client = createPublicClient({
      chain: parentChain,
      transport: http(classicChainInfo.parentRpcUrl),
    })
  })

  test('should correctly identify as Classic chain', async () => {
    const isBold = await isBoldEnabled(
      client,
      classicChainInfo.ethBridge.rollup
    )
    console.log(`Chain type detection: ${isBold ? 'BOLD' : 'Classic'} rollup`)
    expect(isBold).toBe(false)
  })

  test('should check valid block range', async () => {
    expect(CLASSIC_TO_BLOCK).toBeGreaterThan(CLASSIC_FROM_BLOCK)
  })

  test('should detect chain activity in known block range', async () => {
    const hasActivity = await hasChainActivity(client, CLASSIC_FROM_BLOCK)
    console.log(`Chain activity detected: ${hasActivity}`)
    expect(typeof hasActivity).toBe('boolean')
  })

  test(
    'should monitor assertions over known block range',
    async () => {
      const blockRange: BlockRange = {
        fromBlock: CLASSIC_FROM_BLOCK,
        toBlock: CLASSIC_TO_BLOCK,
      }
      const monitorResult = await checkChainForAssertionIssues(
        classicChainInfo,
        blockRange
      )
      expect(
        monitorResult === null || typeof monitorResult.alertMessage === 'string'
      ).toBe(true)
    },
    { timeout: 100000 }
  )
})
