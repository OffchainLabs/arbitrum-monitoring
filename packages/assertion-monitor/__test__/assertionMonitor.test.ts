import { createPublicClient, http, PublicClient } from 'viem'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createChildChainClient,
  hasChainActivity,
  isBoldEnabled,
  fetchMostRecentCreationEvent,
  fetchMostRecentConfirmationEvent,
} from '../blockchain'
import { getChainFromId } from '../chains'
import { checkChainForAssertionIssues, getBlockRange } from '../index'
import { BlockRange, CreationEvent, ConfirmationEvent } from '../types'
import { boldChainInfo, classicChainInfo } from './testConfigs'

// Known block range where we have events (Arbitrum Sepolia)
const BOLD_FROM_BLOCK = 7627075n
const BOLD_TO_BLOCK = 7637075n

// Known block range for Classic chain (Xai Testnet)
const CLASSIC_FROM_BLOCK = 124632400n
const CLASSIC_TO_BLOCK = 124667079n

describe('Assertion Monitor - BOLD Chain', () => {
  let client: PublicClient
  let childChainClient: PublicClient
  let recentCreation: CreationEvent | null = null
  let recentConfirmation: ConfirmationEvent | null = null

  beforeEach(async () => {
    const parentChain = getChainFromId(boldChainInfo.parentChainId)
    client = createPublicClient({
      chain: parentChain,
      transport: http(boldChainInfo.parentRpcUrl),
    })
    childChainClient = createChildChainClient(boldChainInfo)

    // Get most recent events for the known block range
    const [creation, confirmation] = await Promise.all([
      fetchMostRecentCreationEvent<CreationEvent>(
        BOLD_FROM_BLOCK,
        BOLD_TO_BLOCK,
        client,
        boldChainInfo.ethBridge.rollup,
        true
      ),
      fetchMostRecentConfirmationEvent<ConfirmationEvent>(
        BOLD_FROM_BLOCK,
        BOLD_TO_BLOCK,
        client,
        boldChainInfo.ethBridge.rollup,
        true
      )
    ])
    recentCreation = creation
    recentConfirmation = confirmation
  })

  test('should correctly identify as BOLD chain', async () => {
    const isBold = await isBoldEnabled(client, boldChainInfo.ethBridge.rollup)
    console.log(`Chain type detection: ${isBold ? 'BOLD' : 'Classic'} rollup`)
    expect(isBold).toBe(true)
  }, 10000)

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
    const hasActivity = await hasChainActivity(
      childChainClient,
      recentConfirmation?.blockNumber || BOLD_FROM_BLOCK
    )
    console.log(`Chain activity detected: ${hasActivity}`)
    expect(typeof hasActivity).toBe('boolean')
  })

  test('should monitor assertions over known block range', async () => {
    const result = await checkChainForAssertionIssues(boldChainInfo, {
      fromBlock: BOLD_FROM_BLOCK,
      toBlock: BOLD_TO_BLOCK,
    })
    expect(result).toBeNull()
  }, 10000)
})

describe('Assertion Monitor - Classic Chain', () => {
  let client: PublicClient
  let childChainClient: PublicClient
  let recentCreation: CreationEvent | null = null
  let recentConfirmation: ConfirmationEvent | null = null

  beforeEach(async () => {
    const parentChain = getChainFromId(classicChainInfo.parentChainId)
    client = createPublicClient({
      chain: parentChain,
      transport: http(classicChainInfo.parentRpcUrl),
    })
    childChainClient = createChildChainClient(classicChainInfo)

    // Get most recent events for the known block range
    const [creation, confirmation] = await Promise.all([
      fetchMostRecentCreationEvent<CreationEvent>(
        CLASSIC_FROM_BLOCK,
        CLASSIC_TO_BLOCK,
        client,
        classicChainInfo.ethBridge.rollup,
        false
      ),
      fetchMostRecentConfirmationEvent<ConfirmationEvent>(
        CLASSIC_FROM_BLOCK,
        CLASSIC_TO_BLOCK,
        client,
        classicChainInfo.ethBridge.rollup,
        false
      )
    ])
    recentCreation = creation
    recentConfirmation = confirmation
  }, 100000)

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
    const hasActivity = await hasChainActivity(
      childChainClient,
      recentConfirmation?.blockNumber || CLASSIC_FROM_BLOCK
    )
    console.log(`Chain activity detected: ${hasActivity}`)
    expect(typeof hasActivity).toBe('boolean')
  })

  test('should monitor assertions over known block range', async () => {
    const result = await checkChainForAssertionIssues(classicChainInfo, {
      fromBlock: CLASSIC_FROM_BLOCK,
      toBlock: CLASSIC_TO_BLOCK,
    })
    expect(result).toBeNull()
  }, 10000)
})
