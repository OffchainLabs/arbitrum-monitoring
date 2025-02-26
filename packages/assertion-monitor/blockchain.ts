import {
  AbiEvent,
  PublicClient,
  createPublicClient,
  defineChain,
  getContract,
  http,
  type Block,
  type Log,
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
import { CHUNK_SIZE } from './constants'
import { AssertionDataError } from './errors'
import { ChainState, ConfirmationEvent, CreationEvent } from './types'
import { extractBoldBlockHash, extractClassicBlockHash } from './utils'

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
 * Retrieves the latest block number that has been processed by the assertion chain.
 * Uses block hash from assertion data to track L2/L3 state progression.
 */
export async function getLatestCreationBlock(
  childChainClient: PublicClient,
  latestCreationLog: CreationEvent | null,
  isBold: boolean
): Promise<Block | undefined> {
  if (!latestCreationLog) {
    throw new AssertionDataError('No assertion logs found')
  }

  const assertionData = latestCreationLog.args.assertion
  const lastProcessedBlockHash = isBold
    ? extractBoldBlockHash(assertionData)
    : extractClassicBlockHash(assertionData)

  const block = await childChainClient.getBlock({
    blockHash: lastProcessedBlockHash,
  })
  console.log(`Last processed child chain block: ${block.number}`)
  return block
}

/**
 * Gets the latest confirmed block number from assertion logs by finding the corresponding child block.
 * Returns undefined if no confirmed logs are found or if the corresponding block cannot be found.
 */
export async function getLatestConfirmedBlock(
  childChainClient: PublicClient,
  confirmationEvent: ConfirmationEvent | null
): Promise<Block | undefined> {
  try {
    let childLastConfirmedBlock
    if (confirmationEvent) {
      const lastConfirmedBlockhash = confirmationEvent.args.blockHash
      childLastConfirmedBlock = await childChainClient.getBlock({
        blockHash: lastConfirmedBlockhash,
      })
    }
    if (childLastConfirmedBlock) {
      console.log(
        'Found confirmed child block:',
        childLastConfirmedBlock?.number
      )
      return childLastConfirmedBlock
    } else {
      console.log('No confirmed child block found')
      return undefined
    }
  } catch (error) {
    console.error('Failed to get confirmed block from child chain:', error)
    return undefined
  }
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

/**
 * Generic function to fetch the most recent event of a specific type within a block range.
 * Uses exponential backoff and retries to ensure robustness.
 */
export async function fetchMostRecentEvent<
  T extends Log<bigint, number, false, AbiEvent, true>
>(
  fromBlock: bigint,
  toBlock: bigint,
  client: PublicClient,
  rollupAddress: string,
  event: AbiEvent,
  chunkSize: bigint = CHUNK_SIZE,
  eventName?: string
): Promise<T | null> {
  let currentToBlock = toBlock

  while (currentToBlock >= fromBlock) {
    const currentFromBlock =
      currentToBlock - chunkSize + 1n > fromBlock
        ? currentToBlock - chunkSize + 1n
        : fromBlock

    try {
      const logs = await client.getLogs({
        address: rollupAddress as `0x${string}`,
        fromBlock: currentFromBlock,
        toBlock: currentToBlock,
        event,
      })

      if (logs.length > 0) {
        const eventType = eventName || event.name || 'event'
        console.log(
          `Found ${eventType} in block range ${currentFromBlock} to ${currentToBlock}`
        )
        // Return the most recent event (last in the array)
        return logs[logs.length - 1] as T
      }

      // If we've searched all blocks, stop
      if (currentFromBlock === fromBlock) break

      // Move to the next chunk
      currentToBlock = currentFromBlock - 1n

      // Add a small delay between chunks to avoid rate limiting
      await sleep(100)
    } catch (error) {
      console.error(
        `Error in fetchMostRecentEvent for ${eventName || event.name}:`,
        error
      )
      // If we get an error, try a smaller chunk size
      if (chunkSize > 100n) {
        console.log(`Retrying with smaller chunk size: ${chunkSize / 2n}`)
        return fetchMostRecentEvent(
          currentFromBlock,
          currentToBlock,
          client,
          rollupAddress,
          event,
          chunkSize / 2n,
          eventName
        )
      }
      throw error
    }
  }

  return null
}

/**
 * Fetches the most recent creation event (assertion or node) within a block range.
 * Uses exponential backoff and retries to ensure robustness.
 */
export async function fetchMostRecentCreationEvent<T extends CreationEvent>(
  fromBlock: bigint,
  toBlock: bigint,
  client: PublicClient,
  rollupAddress: string,
  isBold: boolean,
  chunkSize: bigint = CHUNK_SIZE
): Promise<T | null> {
  const event = isBold ? ASSERTION_CREATED_EVENT : NODE_CREATED_EVENT
  const eventName = isBold ? 'creation event' : 'node creation event'

  return fetchMostRecentEvent<T>(
    fromBlock,
    toBlock,
    client,
    rollupAddress,
    event,
    chunkSize,
    eventName
  )
}

/**
 * Fetches the most recent confirmation event (assertion or node) within a block range.
 * Uses exponential backoff and retries to ensure robustness.
 */
export async function fetchMostRecentConfirmationEvent<
  T extends ConfirmationEvent
>(
  fromBlock: bigint,
  toBlock: bigint,
  client: PublicClient,
  rollupAddress: string,
  isBold: boolean,
  chunkSize: bigint = CHUNK_SIZE
): Promise<T | null> {
  const event = isBold ? ASSERTION_CONFIRMED_EVENT : NODE_CONFIRMED_EVENT
  const eventName = isBold ? 'confirmation event' : 'node confirmation event'

  return fetchMostRecentEvent<T>(
    fromBlock,
    toBlock,
    client,
    rollupAddress,
    event,
    chunkSize,
    eventName
  )
}

/**
 * Fetches the latest blocks and events to build the `ChainState` object
 */
export const fetchChainState = async ({
  childChainClient,
  parentClient,
  childChainInfo,
  isBold,
  fromBlock,
  toBlock,
}: {
  childChainClient: PublicClient
  parentClient: PublicClient
  childChainInfo: ChainInfo
  isBold: boolean
  fromBlock: bigint
  toBlock: bigint
}): Promise<ChainState> => {
  const childCurrentBlock = await childChainClient.getBlock({
    blockTag: 'latest',
  })

  const parentCurrentBlock = await parentClient.getBlock({
    blockTag: 'latest',
  })

  const recentCreationEvent = await fetchMostRecentCreationEvent(
    fromBlock,
    toBlock,
    parentClient,
    childChainInfo.ethBridge.rollup,
    isBold
  )

  const recentConfirmationEvent = await fetchMostRecentConfirmationEvent(
    fromBlock,
    toBlock,
    parentClient,
    childChainInfo.ethBridge.rollup,
    isBold
  )

  const childLatestConfirmedBlock = await getLatestConfirmedBlock(
    childChainClient,
    recentConfirmationEvent
  )

  const childLatestCreatedBlock = await getLatestCreationBlock(
    childChainClient,
    recentCreationEvent,
    isBold
  )

  // Get parent blocks at creation and confirmation
  let parentBlockAtCreation
  if (recentCreationEvent) {
    parentBlockAtCreation = await parentClient.getBlock({
      blockNumber: recentCreationEvent.blockNumber,
    })
  }

  let parentBlockAtConfirmation
  if (recentConfirmationEvent) {
    parentBlockAtConfirmation = await parentClient.getBlock({
      blockNumber: recentConfirmationEvent.blockNumber,
    })
  }

  const chainState: ChainState = {
    childCurrentBlock,
    childLatestCreatedBlock,
    childLatestConfirmedBlock,
    parentCurrentBlock,
    parentBlockAtCreation,
    parentBlockAtConfirmation,
    recentCreationEvent,
    recentConfirmationEvent,
  }

  console.log('Built chain state blocks:', {
    childCurrentBlock: childCurrentBlock.number,
    childLatestCreatedBlock: childLatestCreatedBlock?.number,
    childLatestConfirmedBlock: childLatestConfirmedBlock?.number,
    parentCurrentBlock: parentCurrentBlock.number,
    parentBlockAtCreation: parentBlockAtCreation?.number,
    parentBlockAtConfirmation: parentBlockAtConfirmation?.number,
  })

  return chainState
}
