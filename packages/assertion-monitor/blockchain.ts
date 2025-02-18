import {
  PublicClient,
  createPublicClient,
  defineChain,
  getContract,
  http,
} from 'viem'
import { ChildNetwork as ChainInfo, sleep } from '../utils'
import {
  ASSERTION_CONFIRMED_EVENT,
  ASSERTION_CREATED_EVENT,
  NODE_CONFIRMED_EVENT,
  NODE_CREATED_EVENT,
  boldABI,
  rollupABI,
} from './abi'
import { AssertionDataError } from './errors'
import { AssertionLogs } from './types'
import { extractBoldBlockHash, extractClassicBlockHash } from './utils'

/** Maximum number of retries for fetching logs */
const RETRIES = 5

/** Base delay in milliseconds between retries */
const RETRY_DELAY_BASE = 100

/** Number of blocks to process in each chunk when fetching logs to avoid RPC timeouts */
const CHUNK_SIZE = 800n

/**
 * Queries the rollup contract to determine if the validator whitelist feature is disabled.
 * Controls which validators can post assertions in non-permissionless mode.
 */
export async function getValidatorWhitelistDisabled(
  client: PublicClient,
  rollupAddress: string
): Promise<boolean> {
  const contract = getContract({
    address: rollupAddress as `0x${string}`,
    abi: rollupABI,
    client,
  })

  return contract.read.validatorWhitelistDisabled()
}

/**
 * Fetches and processes assertion/node creation and confirmation logs for a specific block range.
 * Handles both BOLD assertions and Classic node creation events with their respective confirmations.
 */
export async function processChunk(
  chunkFromBlock: bigint,
  chunkToBlock: bigint,
  client: PublicClient,
  rollupAddress: string,
  isBold: boolean
): Promise<AssertionLogs> {
  console.log(`Processing chunk: ${chunkFromBlock} to ${chunkToBlock}`)
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const createdLogs = await client.getLogs({
        address: rollupAddress as `0x${string}`,
        fromBlock: chunkFromBlock,
        toBlock: chunkToBlock,
        event: isBold ? ASSERTION_CREATED_EVENT : NODE_CREATED_EVENT,
      })
      console.log(
        `Found ${createdLogs.length} ${
          isBold ? 'assertions' : 'nodes'
        } created in chunk`
      )

      const confirmedLogs = await client.getLogs({
        address: rollupAddress as `0x${string}`,
        fromBlock: chunkFromBlock,
        toBlock: chunkToBlock,
        event: isBold ? ASSERTION_CONFIRMED_EVENT : NODE_CONFIRMED_EVENT,
      })
      console.log(
        `Found ${confirmedLogs.length} ${
          isBold ? 'assertions' : 'nodes'
        } confirmed in chunk`
      )

      if (confirmedLogs.length > 0) {
        console.log('\nAnalyzing confirmed events:')
        for (const log of confirmedLogs) {
          try {
            const eventData = isBold
              ? {
                  blockNumber: log.blockNumber,
                  assertionHash: (log as any).args.assertionHash,
                  blockHash: (log as any).args.blockHash,
                  sendRoot: (log as any).args.sendRoot,
                }
              : {
                  blockNumber: log.blockNumber,
                  nodeNum: (log as any).args.nodeNum,
                  blockHash: (log as any).args.blockHash,
                  sendRoot: (log as any).args.sendRoot,
                }
            console.log('Confirmed event:', eventData)
          } catch (error) {
            console.log('Failed to decode confirmed event:', error)
            console.log('Raw log data:', {
              topics: log.topics,
              data: log.data,
              blockNumber: log.blockNumber,
            })
          }
        }
      }

      return {
        createdLogs,
        confirmedLogs,
      }
    } catch (error) {
      console.error(
        `Error fetching logs (attempt ${attempt}/${RETRIES}):`,
        error
      )
      if (attempt === RETRIES) throw error
      console.log(
        `Retrying in ${RETRY_DELAY_BASE * Math.pow(2, attempt - 1)}ms...`
      )
      await sleep(RETRY_DELAY_BASE * Math.pow(2, attempt - 1))
    }
  }

  return {
    createdLogs: [],
    confirmedLogs: [],
  }
}

/**
 * Processes a large block range by breaking it into smaller chunks to handle RPC limitations.
 * Essential for monitoring long periods of assertion/node history efficiently.
 */
export async function processChunkedRange(
  fromBlock: bigint,
  toBlock: bigint,
  client: PublicClient,
  rollupAddress: string,
  isBold: boolean
): Promise<AssertionLogs[]> {
  const results: AssertionLogs[] = []

  if (fromBlock === toBlock) {
    return results
  }

  let currentFromBlock = fromBlock

  while (currentFromBlock <= toBlock) {
    const currentToBlock =
      currentFromBlock + CHUNK_SIZE - 1n < toBlock
        ? currentFromBlock + CHUNK_SIZE - 1n
        : toBlock

    const result = await processChunk(
      currentFromBlock,
      currentToBlock,
      client,
      rollupAddress,
      isBold
    )
    results.push(result)

    if (currentToBlock === toBlock) break

    currentFromBlock = currentToBlock + 1n
  }

  return results
}

/**
 * Retrieves the latest block number that has been processed by the assertion chain.
 * Uses block hash from assertion data to track L2/L3 state progression.
 */
export async function getLastProcessedBlock(
  childChainClient: PublicClient,
  logs: AssertionLogs,
  isBold: boolean
): Promise<bigint> {
  if (logs.createdLogs.length === 0) {
    throw new AssertionDataError('No assertion logs found')
  }

  const latestAssertion = logs.createdLogs[logs.createdLogs.length - 1]
  const assertionData = latestAssertion.args.assertion
  const lastProcessedBlockHash = isBold
    ? extractBoldBlockHash(assertionData)
    : extractClassicBlockHash(assertionData)

  const block = await childChainClient.getBlock({
    blockHash: lastProcessedBlockHash,
  })
  console.log(`Last processed child chain block: ${block.number}`)
  return block.number
}

/**
 * Scans a block range to determine if there are any transactions, indicating chain activity.
 * Used to verify if chain inactivity is causing missing assertions.
 */
export async function hasChainActivity(
  childChainClient: PublicClient,
  fromBlock: bigint,
  toBlock: bigint
): Promise<boolean> {
  const BATCH_SIZE = 100n
  let currentBlock = fromBlock

  while (currentBlock <= toBlock) {
    const endBlock =
      currentBlock + BATCH_SIZE > toBlock ? toBlock : currentBlock + BATCH_SIZE

    for (let blockNum = currentBlock; blockNum <= endBlock; blockNum++) {
      const block = await childChainClient.getBlock({ blockNumber: blockNum })
      if (block.transactions.length > 0) {
        return true
      }
    }

    currentBlock += BATCH_SIZE + 1n
  }

  return false
}

/**
 * Determines if the rollup contract is using BOLD mode by checking for a genesis assertion hash.
 * BOLD mode uses a different assertion format and validation process than Classic mode.
 */
export async function isBoldEnabled(
  client: PublicClient,
  rollupAddress: string
): Promise<boolean> {
  try {
    const contract = getContract({
      address: rollupAddress as `0x${string}`,
      abi: boldABI,
      client,
    })

    const genesisHash = await contract.read.genesisAssertionHash()
    return !!genesisHash
  } catch (error) {
    return false
  }
}

/**
 * Configures and creates a viem PublicClient instance for interacting with the child chain.
 * Used to monitor L2/L3 chain state and transaction activity.
 */
export function createChildChainClient(
  childChainInfo: ChainInfo
): PublicClient {
  const childChain = defineChain({
    id: childChainInfo.chainId,
    name: childChainInfo.name,
    network: 'childChain',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [childChainInfo.orbitRpcUrl],
      },
      public: {
        http: [childChainInfo.orbitRpcUrl],
      },
    },
  })

  return createPublicClient({
    chain: childChain,
    transport: http(childChainInfo.orbitRpcUrl),
  })
}
