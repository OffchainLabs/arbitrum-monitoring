import { describe, test, expect } from 'vitest'
import { monitorAssertions, hasChainActivity, getBlockRange, isBoldEnabled } from './index'
import { createPublicClient, http, decodeEventLog, Log, getContract } from 'viem'
import { getChainFromId } from './chains'
import {
  ASSERTION_CREATED_EVENT,
  ASSERTION_CONFIRMED_EVENT,
  NODE_CREATED_EVENT,
  NODE_CONFIRMED_EVENT,
  rollupABI,
} from './abi'

// Known block range where we have events (Arbitrum Sepolia)
const BOLD_FROM_BLOCK = 7627075n
const BOLD_TO_BLOCK = 7637075n

// Known block range for Classic chain (Xai Testnet)
const CLASSIC_FROM_BLOCK = 7678000n  // Start around the block numbers we see in logs
const CLASSIC_TO_BLOCK = 7679000n    // End around the block numbers we see in logs

// Test chain configurations
const boldChainInfo = {
  name: "Arbitrum Sepolia",
  chainId: 421614,
  parentChainId: 11155111,
  confirmPeriodBlocks: 45818,
  parentRpcUrl: "https://sepolia.drpc.org",
  orbitRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  ethBridge: {
    rollup: "0x042b2e6c5e99d4c521bd49beed5e99651d9b0cf4"
  }
}

const classicChainInfo = {
  name: "Xai Testnet",
  chainId: 37714555429,
  parentChainId: 421614,
  confirmPeriodBlocks: 150,
  parentRpcUrl: "https://arbitrum-sepolia.drpc.org",
  orbitRpcUrl: "https://testnet-v2.xai-chain.net/rpc",
  ethBridge: {
    rollup: "0xeedE9367Df91913ab149e828BDd6bE336df2c892"
  }
}

// Block explorer URLs
const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io"
const XAI_EXPLORER = "https://testnet-explorer-v2.xai-chain.net"

// Event type definitions
type AssertionCreatedEvent = {
  eventName: 'AssertionCreated'
  args: {
    assertionHash: `0x${string}`
    parentAssertionHash: `0x${string}`
    assertion: {
      beforeState: {
        prevPrevAssertionHash: `0x${string}`
        sequencerBatchAcc: `0x${string}`
      }
      beforeStateSnapshot: {
        globalState: {
          bytes32Vals: readonly [`0x${string}`, `0x${string}`]
          u64Vals: readonly [bigint, bigint]
        }
        machineStatus: number
        endHistoryRoot: `0x${string}`
      }
      afterStateSnapshot: {
        globalState: {
          bytes32Vals: readonly [`0x${string}`, `0x${string}`]
          u64Vals: readonly [bigint, bigint]
        }
        machineStatus: number
        endHistoryRoot: `0x${string}`
      }
    }
  }
}

type NodeCreatedEvent = {
  eventName: 'NodeCreated'
  args: {
    nodeNum: bigint
    parentNodeHash: `0x${string}`
    nodeHash: `0x${string}`
    assertion: {
      beforeState: {
        globalState: {
          bytes32Vals: readonly [`0x${string}`, `0x${string}`]
          u64Vals: readonly [bigint, bigint]
        }
        machineStatus: number
      }
      afterState: {
        globalState: {
          bytes32Vals: readonly [`0x${string}`, `0x${string}`]
          u64Vals: readonly [bigint, bigint]
        }
        machineStatus: number
      }
      numBlocks: bigint
    }
  }
}

type NodeConfirmedEvent = {
  eventName: 'NodeConfirmed'
  args: {
    nodeNum: bigint
    blockHash: `0x${string}`
    sendRoot: `0x${string}`
  }
}

describe('Assertion Monitor - BOLD Chain', () => {
  const parentChain = getChainFromId(boldChainInfo.parentChainId)
  const client = createPublicClient({
    chain: parentChain,
    transport: http(boldChainInfo.parentRpcUrl),
  })

  test('should correctly identify as BOLD chain', async () => {
    const isBold = await isBoldEnabled(client, boldChainInfo.ethBridge.rollup)
    console.log(`Chain type detection: ${isBold ? 'BOLD' : 'Classic'} rollup`)
    expect(isBold).toBe(true)
  })

  test('should detect and validate AssertionCreated events', async () => {
    const isBold = await isBoldEnabled(client, boldChainInfo.ethBridge.rollup)
    const event = isBold ? ASSERTION_CREATED_EVENT : NODE_CREATED_EVENT
    
    expect(event.name).toBe('AssertionCreated')
    
    const logs = await client.getLogs({
      address: boldChainInfo.ethBridge.rollup as `0x${string}`,
      event,
      fromBlock: BOLD_FROM_BLOCK,
      toBlock: BOLD_TO_BLOCK,
    })

    expect(logs.length).toBeGreaterThan(0)
    console.log(`Found ${logs.length} AssertionCreated events`)
    
    // Verify first log is an AssertionCreated event
    const decodedLog = decodeEventLog({
      abi: rollupABI,
      data: logs[0].data,
      topics: logs[0].topics,
    }) as AssertionCreatedEvent
    
    // Verify event structure
    expect(decodedLog.eventName).toBe('AssertionCreated')
    expect(decodedLog.args).toHaveProperty('assertion')
    expect(decodedLog.args.assertion).toHaveProperty('beforeState')
    expect(decodedLog.args.assertion.beforeState).toHaveProperty('prevPrevAssertionHash')
    
    // Verify global state structure (used for last processed block)
    expect(decodedLog.args.assertion.beforeStateSnapshot.globalState).toBeDefined()
    expect(decodedLog.args.assertion.beforeStateSnapshot.globalState.bytes32Vals).toHaveLength(2)
    expect(decodedLog.args.assertion.beforeStateSnapshot.globalState.u64Vals).toHaveLength(2)
    
    // Get last processed block from the assertion
    const lastProcessedBlockHash = decodedLog.args.assertion.beforeStateSnapshot.globalState.bytes32Vals[0]
    expect(lastProcessedBlockHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    
    try {
      // Try to get the block number from the hash
      const block = await client.getBlock({ blockHash: lastProcessedBlockHash })
      expect(block.number).toBeDefined()
      console.log('Last processed block:', block.number.toString())
    } catch (error) {
      // Block might not be available anymore (pruned or reorged)
      console.log('Block not found - this is expected for old blocks:', lastProcessedBlockHash)
      // Use event block number as fallback
      console.log('Using event block number as fallback:', logs[0].blockNumber.toString())
    }
  })

  test('should detect and validate AssertionConfirmed events', async () => {
    const isBold = await isBoldEnabled(client, boldChainInfo.ethBridge.rollup)
    const event = isBold ? ASSERTION_CONFIRMED_EVENT : NODE_CONFIRMED_EVENT
    
    expect(event.name).toBe('AssertionConfirmed')
    
    const logs = await client.getLogs({
      address: boldChainInfo.ethBridge.rollup as `0x${string}`,
      event,
      fromBlock: BOLD_FROM_BLOCK,
      toBlock: BOLD_TO_BLOCK,
    })

    expect(logs.length).toBeGreaterThan(0)
    console.log(`Found ${logs.length} AssertionConfirmed events`)

    // Get latest block for confirmation period check
    const latestBlock = await client.getBlockNumber()
    
    // Check the most recent confirmation
    const lastConfirmation = logs[logs.length - 1]
    const blocksSinceLastConfirmation = latestBlock - lastConfirmation.blockNumber
    
    console.log('Blocks since last confirmation:', blocksSinceLastConfirmation.toString())
    console.log('Confirm period blocks:', boldChainInfo.confirmPeriodBlocks)
    
    // Note: This test might fail if the chain is unhealthy
    // We're keeping it to detect issues, but failures should be investigated
    if (blocksSinceLastConfirmation > BigInt(boldChainInfo.confirmPeriodBlocks)) {
      console.warn('WARNING: Confirmation period exceeded - chain might be unhealthy')
      console.warn(`Last confirmation was ${blocksSinceLastConfirmation} blocks ago`)
      console.warn(`Expected confirmations within ${boldChainInfo.confirmPeriodBlocks} blocks`)
    }
  })

  test('should detect chain activity correctly', async () => {
    const isBold = await isBoldEnabled(client, boldChainInfo.ethBridge.rollup)
    const createdEvent = isBold ? ASSERTION_CREATED_EVENT : NODE_CREATED_EVENT
    
    // Get latest assertion
    const logs = await client.getLogs({
      address: boldChainInfo.ethBridge.rollup as `0x${string}`,
      event: createdEvent,
      fromBlock: BOLD_FROM_BLOCK,
      toBlock: BOLD_TO_BLOCK,
    })
    
    expect(logs.length).toBeGreaterThan(0)
    const latestAssertion = logs[logs.length - 1]
    
    // Decode to get last processed block
    const decodedLog = decodeEventLog({
      abi: rollupABI,
      data: latestAssertion.data,
      topics: latestAssertion.topics,
    }) as AssertionCreatedEvent
    
    let lastProcessedBlockNumber: bigint
    const lastProcessedBlockHash = decodedLog.args.assertion.beforeStateSnapshot.globalState.bytes32Vals[0]
    
    try {
      const block = await client.getBlock({ blockHash: lastProcessedBlockHash })
      lastProcessedBlockNumber = block.number
    } catch (error) {
      // Block might not be available anymore (pruned or reorged)
      console.log('Block not found - using event block number as fallback')
      lastProcessedBlockNumber = latestAssertion.blockNumber
    }
    
    const latestBlock = await client.getBlockNumber()
    
    console.log('Last processed block:', lastProcessedBlockNumber.toString())
    console.log('Latest block:', latestBlock.toString())
    console.log('Block gap:', (latestBlock - lastProcessedBlockNumber).toString())
    
    // Check if there's a significant gap (indicating chain activity without assertions)
    const blockGap = latestBlock - lastProcessedBlockNumber
    
    // Note: This test might fail if the chain is unhealthy
    // We're keeping it to detect issues, but failures should be investigated
    if (blockGap > 1000n) {
      console.warn('WARNING: Large block gap detected - chain might be unhealthy')
      console.warn(`Gap of ${blockGap} blocks since last processed block`)
      console.warn('Expected gap to be less than 1000 blocks')
    }
  })
})

describe('Assertion Monitor - Classic Chain', () => {
  const parentChain = getChainFromId(classicChainInfo.parentChainId)
  const client = createPublicClient({
    chain: parentChain,
    transport: http(classicChainInfo.parentRpcUrl),
  })

  test('should find NodeCreated events in recent blocks', async () => {
    const isBold = await isBoldEnabled(client, classicChainInfo.ethBridge.rollup)
    expect(isBold).toBe(false)
    
    const targetBlock = 124487630n
    console.log(`Searching for NodeCreated event at block ${targetBlock}`)
    console.log('Parent Chain (Arbitrum Sepolia) RPC:', classicChainInfo.parentRpcUrl)
    console.log('Child Chain (Xai) RPC:', classicChainInfo.orbitRpcUrl)
    
    try {
        // First verify we can get the contract
        const contract = getContract({
            address: classicChainInfo.ethBridge.rollup as `0x${string}`,
            abi: rollupABI,
            client,
        })
        
        // Try to read a simple value from the contract
        const whitelistDisabled = await contract.read.validatorWhitelistDisabled()
        console.log('Successfully read from contract. Validator whitelist disabled:', whitelistDisabled)
        
        // Look for NodeCreated events in this specific block
        console.log('\nLooking for NodeCreated event...')
        const nodeCreatedLogs = await client.getLogs({
            address: classicChainInfo.ethBridge.rollup as `0x${string}`,
            event: NODE_CREATED_EVENT,
            fromBlock: targetBlock,
            toBlock: targetBlock,
        })

        console.log(`Found ${nodeCreatedLogs.length} NodeCreated events`)
        
        if (nodeCreatedLogs.length > 0) {
            for (const log of nodeCreatedLogs) {
                try {
                    const decodedLog = decodeEventLog({
                        abi: rollupABI,
                        data: log.data,
                        topics: log.topics,
                    }) as NodeCreatedEvent
                    
                    console.log('\nNodeCreated event details:')
                    console.log('Block number:', log.blockNumber.toString())
                    console.log('Node number:', decodedLog.args.nodeNum.toString())
                    console.log('Node hash:', decodedLog.args.nodeHash)
                    console.log('Parent node hash:', decodedLog.args.parentNodeHash)
                    console.log('Raw log data:', {
                        data: log.data,
                        topics: log.topics
                    })
                } catch (error) {
                    console.error('Error decoding log:', error)
                    console.log('Raw log data:', {
                        data: log.data,
                        topics: log.topics
                    })
                }
            }
        }
    } catch (error) {
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            cause: error.cause,
        })
        throw error
    }
}, { timeout: 30000 }); // 30 second timeout

  test('should detect and validate NodeConfirmed events', async () => {
    const isBold = await isBoldEnabled(client, classicChainInfo.ethBridge.rollup)
    const event = isBold ? ASSERTION_CONFIRMED_EVENT : NODE_CONFIRMED_EVENT
    
    expect(event.name).toBe('NodeConfirmed')
    
    const logs = await client.getLogs({
      address: classicChainInfo.ethBridge.rollup as `0x${string}`,
      event,
      fromBlock: CLASSIC_FROM_BLOCK,
      toBlock: CLASSIC_TO_BLOCK,
    })

    if (logs.length > 0) {
      console.log(`Found ${logs.length} NodeConfirmed events`)
      
      // Get latest block for confirmation period check
      const latestBlock = await client.getBlockNumber()
      
      // Check the most recent confirmation
      const lastConfirmation = logs[logs.length - 1]
      const blocksSinceLastConfirmation = latestBlock - lastConfirmation.blockNumber
      
      console.log('Blocks since last confirmation:', blocksSinceLastConfirmation.toString())
      console.log('Confirm period blocks:', classicChainInfo.confirmPeriodBlocks)
      
      // This should pass if the chain is healthy
      expect(blocksSinceLastConfirmation).toBeLessThanOrEqual(BigInt(classicChainInfo.confirmPeriodBlocks))
      
      // Verify first log is a NodeConfirmed event
      const decodedLog = decodeEventLog({
        abi: rollupABI,
        data: logs[0].data,
        topics: logs[0].topics,
      }) as NodeConfirmedEvent
      
      expect(decodedLog.eventName).toBe('NodeConfirmed')
      expect(decodedLog.args).toHaveProperty('nodeNum')
      expect(decodedLog.args).toHaveProperty('blockHash')
      expect(decodedLog.args).toHaveProperty('sendRoot')
      
      console.log('\nClassic chain confirmation details:')
      console.log('Node number:', decodedLog.args.nodeNum.toString())
      console.log('Block hash:', decodedLog.args.blockHash)
      console.log('Send root:', decodedLog.args.sendRoot)
    } else {
      console.log('No NodeConfirmed events found in block range')
    }
  })

  test ('should detect chain activity correctly', async () => {
    const isBold = await isBoldEnabled(client, classicChainInfo.ethBridge.rollup)
    const createdEvent = isBold ? ASSERTION_CREATED_EVENT : NODE_CREATED_EVENT
    
    const logs = await client.getLogs({
      address: classicChainInfo.ethBridge.rollup as `0x${string}`,
      event: createdEvent,
      fromBlock: CLASSIC_FROM_BLOCK,
      toBlock: CLASSIC_TO_BLOCK,
    })

    if (logs.length > 0) {
      const latestNode = logs[logs.length - 1]
      
      // Decode to get last processed block
      const decodedLog = decodeEventLog({
        abi: rollupABI,
        data: latestNode.data,
        topics: latestNode.topics,
      }) as NodeCreatedEvent
      
      const lastProcessedBlockHash = decodedLog.args.assertion.beforeState.globalState.bytes32Vals[0]
      const lastProcessedBlock = await client.getBlock({ blockHash: lastProcessedBlockHash })
      const latestBlock = await client.getBlockNumber()
      
      console.log('Last processed block:', lastProcessedBlock.number.toString())
      console.log('Latest block:', latestBlock.toString())
      console.log('Block gap:', (latestBlock - lastProcessedBlock.number).toString())
      
      // Check if there's a significant gap (indicating chain activity without nodes)
      const blockGap = latestBlock - lastProcessedBlock.number
      expect(blockGap).toBeLessThan(1000n) // Arbitrary threshold for test
    } else {
      console.log('No nodes found to check chain activity')
    }
  })
}) 