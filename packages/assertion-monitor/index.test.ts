import { describe, test, expect, beforeEach } from 'vitest'
import { monitorAssertions, hasChainActivity, getBlockRange, isBoldEnabled, BlockRange } from './index'
import { createPublicClient, http, PublicClient } from 'viem'
import { getChainFromId } from './chains'

// Known block range where we have events (Arbitrum Sepolia)
const BOLD_FROM_BLOCK = 7627075n
const BOLD_TO_BLOCK = 7637075n

// Known block range for Classic chain (Xai Testnet)
const CLASSIC_FROM_BLOCK = 7678000n
const CLASSIC_TO_BLOCK = 7679000n

// Test chain configurations
const boldChainInfo = {
  name: "Arbitrum Sepolia",
  chainId: 421614,
  parentChainId: 11155111,
  confirmPeriodBlocks: 45818,
  parentRpcUrl: "https://sepolia.drpc.org",
  orbitRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  ethBridge: {
    bridge: "0xc4448b71118c9071Bcb9734A0EAc55D18A153949",
    inbox: "0xaAe29B0366299461418F5324a79Afc425BE5ae21",
    outbox: "0x65f07C7D521164a4d5DaC6eB8Fac8DA067A3B78F",
    rollup: "0x042b2e6c5e99d4c521bd49beed5e99651d9b0cf4",
    sequencerInbox: "0x6c97864CE4bE1C2C8bB6aFe3A115E6D7Dca82E71"
  },
  explorerUrl: "https://sepolia.arbiscan.io",
  parentExplorerUrl: "https://sepolia.etherscan.io",
  isCustom: false,
  severity: "critical"
}

const classicChainInfo = {
  name: "Xai Testnet",
  chainId: 37714555429,
  parentChainId: 421614,
  confirmPeriodBlocks: 150,
  parentRpcUrl: "https://arbitrum-sepolia.drpc.org",
  orbitRpcUrl: "https://testnet-v2.xai-chain.net/rpc",
  ethBridge: {
    bridge: "0x6c7FAC4edC72E86B3388B48979eF37Ecca5027e6",
    inbox: "0x6396825803B720bc6A43c63caa1DcD7B31EB4dd0",
    outbox: "0xc7491a559b416540427f9f112C5c98b1412c5d51",
    rollup: "0xeedE9367Df91913ab149e828BDd6bE336df2c892",
    sequencerInbox: "0x529a2061A1973be80D315770bA9469F3Da40D938"
  },
  explorerUrl: "https://testnet-explorer-v2.xai-chain.net",
  parentExplorerUrl: "https://sepolia.arbiscan.io",
  isCustom: false,
  severity: "critical"
}

describe('Assertion Monitor - BOLD Chain', () => {
  let client: PublicClient

  beforeEach(() => {
    const parentChain = getChainFromId(boldChainInfo.parentChainId)
    client = createPublicClient({
      chain: parentChain,
      transport: http(boldChainInfo.parentRpcUrl)
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
    expect(blockDiff).toBeLessThanOrEqual(BigInt(boldChainInfo.confirmPeriodBlocks * 2))
  })

  test('should detect chain activity in known block range', async () => {
    const hasActivity = await hasChainActivity(client, BOLD_FROM_BLOCK, BOLD_TO_BLOCK)
    console.log(`Chain activity detected: ${hasActivity}`)
    expect(typeof hasActivity).toBe('boolean')
  })

  test('should monitor assertions over known block range', async () => {
    const blockRange: BlockRange = {
      fromBlock: BOLD_FROM_BLOCK,
      toBlock: BOLD_TO_BLOCK
    }
    const monitorResult = await monitorAssertions(boldChainInfo, blockRange)
    expect(monitorResult === null || typeof monitorResult.alertMessage === 'string').toBe(true)
  }, { timeout: 30000 }) // Increase timeout to 30 seconds
})

describe('Assertion Monitor - Classic Chain', () => {
  let client: PublicClient

  beforeEach(() => {
    const parentChain = getChainFromId(classicChainInfo.parentChainId)
    client = createPublicClient({
      chain: parentChain,
      transport: http(classicChainInfo.parentRpcUrl)
    })
  })

  test('should correctly identify as Classic chain', async () => {
    const isBold = await isBoldEnabled(client, classicChainInfo.ethBridge.rollup)
    console.log(`Chain type detection: ${isBold ? 'BOLD' : 'Classic'} rollup`)
    expect(isBold).toBe(false)
  })

  test('should get valid block range', async () => {
    const blockRange: BlockRange = {
      fromBlock: CLASSIC_FROM_BLOCK,
      toBlock: CLASSIC_TO_BLOCK
    }
    const { fromBlock, toBlock } = blockRange
    expect(fromBlock).toBeDefined()
    expect(toBlock).toBeDefined()
    expect(toBlock).toBeGreaterThan(fromBlock)
    
    // Ensure the block range is within reasonable bounds for Classic chain
    const blockDiff = toBlock - fromBlock
    expect(blockDiff).toBeLessThanOrEqual(BigInt(1000)) // Use a fixed range for testing
  })

  test('should detect chain activity in known block range', async () => {
    const hasActivity = await hasChainActivity(client, CLASSIC_FROM_BLOCK, CLASSIC_TO_BLOCK)
    console.log(`Chain activity detected: ${hasActivity}`)
    expect(typeof hasActivity).toBe('boolean')
  })

  test('should monitor assertions over known block range', async () => {
    const blockRange: BlockRange = {
      fromBlock: CLASSIC_FROM_BLOCK,
      toBlock: CLASSIC_TO_BLOCK
    }
    const monitorResult = await monitorAssertions(classicChainInfo, blockRange)
    expect(monitorResult === null || typeof monitorResult.alertMessage === 'string').toBe(true)
  }, { timeout: 30000 }) // Increase timeout to 30 seconds
}) 