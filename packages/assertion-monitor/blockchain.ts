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
import { ChildNetwork as ChainInfo, processBlockRangeInChunks } from 'utils'
import {
  ASSERTION_CONFIRMED_EVENT,
  ASSERTION_CREATED_EVENT,
  NODE_CONFIRMED_EVENT,
  NODE_CREATED_EVENT,
  boldABI,
  rollupABI,
} from './abi'
import {
  getBlockTimeForChain,
  getChainFromId,
  getConfirmPeriodSeconds,
} from './chains'
import {
  CHUNK_SIZE,
  MIN_BASE_STAKE_THRESHOLD,
  UNCONFIRMED_ASSERTION_GRACE_SECONDS,
} from './constants'
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
 * Checks if the baseStake for a BoLD chain is below a threshold that would indicate
 * permissionless validation might be disabled or restricted.
 * A very low baseStake could indicate that validation is not intended to be permissionless.
 */
export async function fetchIsBaseStakeBelowThreshold(
  client: PublicClient,
  rollupAddress: string,
  isBold: boolean,
  thresholdInWei: bigint = MIN_BASE_STAKE_THRESHOLD
): Promise<boolean> {
  if (!isBold) {
    return false
  }

  try {
    const contract = getContract({
      address: rollupAddress as `0x${string}`,
      abi: boldABI,
      client,
    })

    const baseStake = await contract.read.baseStake()
    console.log(`Base stake for rollup ${rollupAddress}: ${baseStake} wei`)
    return baseStake < thresholdInWei
  } catch (error) {
    console.error(`Error checking baseStake: ${error}`)
    // Default to false if we can't check
    return false
  }
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
    return undefined
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
 * Searches backwards in chunks, returning the first (most recent) match found.
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
  return processBlockRangeInChunks<T | null>(
    Number(fromBlock),
    Number(toBlock),
    Number(chunkSize),
    async (from, to) => {
      const logs = await client.getLogs({
        address: rollupAddress as `0x${string}`,
        fromBlock: BigInt(from),
        toBlock: BigInt(to),
        event,
      })
      if (logs.length > 0) {
        const eventType = eventName || event.name || 'event'
        console.log(`Found ${eventType} in block range ${from} to ${to}`)
        return logs[logs.length - 1] as T
      }
      return null
    },
    (prev, next) => next ?? prev,
    null,
    { reverse: true, stopWhen: result => result !== null, minChunkSize: 100 }
  )
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
 * Fetches the newest creation event old enough to have been confirmed by now.
 * The search reaches one confirm period before fromBlock: a creation that
 * recent can only be confirmed within [fromBlock, toBlock], so when that range
 * has no confirmation events the creation found is still unconfirmed.
 */
export async function fetchConfirmableCreationEvent<T extends CreationEvent>(
  fromBlock: bigint,
  toBlock: bigint,
  client: PublicClient,
  childChainInfo: ChainInfo,
  isBold: boolean,
  chunkSize: bigint = CHUNK_SIZE
): Promise<T | null> {
  const parentBlockTime = getBlockTimeForChain(
    getChainFromId(childChainInfo.parentChainId)
  )
  const toParentBlocks = (seconds: number) =>
    BigInt(Math.ceil(seconds / parentBlockTime))

  const confirmPeriodSeconds = getConfirmPeriodSeconds(childChainInfo)
  const searchFrom = fromBlock - toParentBlocks(confirmPeriodSeconds)
  const searchTo =
    toBlock -
    toParentBlocks(confirmPeriodSeconds + UNCONFIRMED_ASSERTION_GRACE_SECONDS)

  if (searchTo < 0n) {
    return null
  }

  return fetchMostRecentCreationEvent<T>(
    searchFrom > 0n ? searchFrom : 0n,
    searchTo,
    client,
    childChainInfo.ethBridge.rollup,
    isBold,
    chunkSize
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
  chunkSize = CHUNK_SIZE,
}: {
  childChainClient: PublicClient
  parentClient: PublicClient
  childChainInfo: ChainInfo
  isBold: boolean
  fromBlock: bigint
  toBlock: bigint
  chunkSize?: bigint
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
    isBold,
    chunkSize
  )

  const recentConfirmationEvent = await fetchMostRecentConfirmationEvent(
    fromBlock,
    toBlock,
    parentClient,
    childChainInfo.ethBridge.rollup,
    isBold,
    chunkSize
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

  let childFirstUnassertedBlock
  if (
    childLatestCreatedBlock?.number != null &&
    childCurrentBlock.number != null &&
    childCurrentBlock.number > childLatestCreatedBlock.number
  ) {
    childFirstUnassertedBlock = await childChainClient.getBlock({
      blockNumber: childLatestCreatedBlock.number + 1n,
    })
  }

  let parentBlockAtConfirmableCreation
  if (recentCreationEvent && !recentConfirmationEvent) {
    const confirmableCreationEvent = await fetchConfirmableCreationEvent(
      fromBlock,
      toBlock,
      parentClient,
      childChainInfo,
      isBold,
      chunkSize
    )
    if (confirmableCreationEvent) {
      parentBlockAtConfirmableCreation = await parentClient.getBlock({
        blockNumber: confirmableCreationEvent.blockNumber,
      })
    }
  }

  const isValidatorWhitelistDisabled = await getValidatorWhitelistDisabled(
    parentClient,
    childChainInfo.ethBridge.rollup
  )
  const isBaseStakeBelowThreshold = await fetchIsBaseStakeBelowThreshold(
    parentClient,
    childChainInfo.ethBridge.rollup,
    isBold
  )

  const chainState: ChainState = {
    childCurrentBlock,
    childLatestCreatedBlock,
    childLatestConfirmedBlock,
    parentCurrentBlock,
    parentBlockAtCreation,
    parentBlockAtConfirmation,
    childFirstUnassertedBlock,
    parentBlockAtConfirmableCreation,
    recentCreationEvent,
    recentConfirmationEvent,
    isValidatorWhitelistDisabled,
    isBaseStakeBelowThreshold,
    searchFromBlock: fromBlock,
    searchToBlock: toBlock,
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
