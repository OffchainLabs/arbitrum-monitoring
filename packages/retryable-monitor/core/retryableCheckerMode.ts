/*
You can check retryables in two modes:
1. One-off mode: Check retryables for a specific block range and exit
2. Continuous mode / Watch mode: Check retryables for the latest blocks, and continue checking for new blocks as they are added to the chain

```

*/

import { providers } from 'ethers'
import { SEVEN_DAYS_IN_SECONDS } from '@arbitrum/sdk/dist/lib/dataEntities/constants'
import { OnFailedRetryableFound } from './types'
import { ChildNetwork } from '../../utils'
import { checkRetryables } from './retryableChecker'

export const getParentChainBlockTime = (childChain: ChildNetwork) => {
  const parentChainId = childChain.parentChainId

  // for Ethereum / Sepolia / Holesky
  if (
    parentChainId === 1 ||
    parentChainId === 11155111 ||
    parentChainId === 17000
  ) {
    return 12
  }

  // for Base / Base Sepolia
  if (parentChainId === 8453 || parentChainId === 84532) {
    return 2
  }

  // for arbitrum networks, return the standard block time
  return 2 // ARB_MINIMUM_BLOCK_TIME_IN_SECONDS
}

export const checkRetryablesOneOff = async (
  parentChainProvider: providers.Provider,
  childChainProvider: providers.Provider,
  childChain: ChildNetwork,
  fromBlock: number,
  toBlock: number,
  enableAlerting: boolean,
  onFailedRetryableFound: OnFailedRetryableFound
): Promise<number> => {
  if (toBlock === 0) {
    try {
      const currentBlock = await parentChainProvider.getBlockNumber()
      if (!currentBlock) {
        throw new Error('Failed to retrieve the latest block.')
      }
      toBlock = currentBlock

      // if no `fromBlock` or `toBlock` is provided, monitor for 14 days worth of blocks only
      // only enforce `fromBlock` check if we want to report the ticket to the alerting system
      if (fromBlock === 0 && enableAlerting) {
        fromBlock =
          toBlock -
          (2 * SEVEN_DAYS_IN_SECONDS) / getParentChainBlockTime(childChain)
        console.log(
          `Alerting mode enabled: limiting block-range to last 14 days [${fromBlock} to ${toBlock}]`
        )
      }
    } catch (error) {
      console.error(
        `Error getting the latest block: ${(error as Error).message}`
      )
      throw error
    }
  }

  const MAX_BLOCKS_TO_PROCESS = 5000 // event_logs can only be processed in batches of MAX_BLOCKS_TO_PROCESS blocks

  // if the block range provided is >=MAX_BLOCKS_TO_PROCESS, we might get rate limited while fetching logs from the node
  // so we break down the range into smaller chunks and process them sequentially
  // generate the final ranges' batches to process [ [fromBlock, toBlock], [fromBlock, toBlock], ...]
  const ranges = []
  for (let i = fromBlock; i <= toBlock; i += MAX_BLOCKS_TO_PROCESS) {
    ranges.push([i, Math.min(i + MAX_BLOCKS_TO_PROCESS - 1, toBlock)])
  }

  let retryablesFound = false
  for (const range of ranges) {
    retryablesFound =
      (await checkRetryables(
        parentChainProvider,
        childChainProvider,
        childChain,
        childChain.ethBridge.bridge,
        range[0],
        range[1],
        enableAlerting,
        onFailedRetryableFound
      )) || retryablesFound // the final `retryablesFound` value is the OR of all the `retryablesFound` for ranges
  }

  return toBlock
}

export const checkRetryablesContinuous = async (
  parentChainProvider: providers.Provider,
  childChainProvider: providers.Provider,
  childChain: ChildNetwork,
  fromBlock: number,
  toBlock: number,
  enableAlerting: boolean,
  continuous: boolean,
  onFailedRetryableFound: OnFailedRetryableFound
) => {
  const processingDurationInSeconds = 180
  let isContinuous = continuous
  const startTime = Date.now()

  // Function to process blocks and check for retryables
  const processBlocks = async () => {
    const lastBlockChecked = await checkRetryablesOneOff(
      parentChainProvider,
      childChainProvider,
      childChain,
      fromBlock,
      toBlock,
      enableAlerting,
      onFailedRetryableFound
    )
    console.log('Check completed for block:', lastBlockChecked)
    fromBlock = lastBlockChecked + 1
    console.log('Continuing from block:', fromBlock)

    toBlock = await parentChainProvider.getBlockNumber()
    console.log(`Processed blocks up to ${lastBlockChecked}`)

    return lastBlockChecked
  }

  // Continuous loop for checking retryables
  while (isContinuous) {
    const lastBlockChecked = await processBlocks()

    if (lastBlockChecked >= toBlock) {
      // Wait for a short interval before checking again
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    const currentTime = Date.now()
    const elapsedTimeInSeconds = Math.floor((currentTime - startTime) / 1000)

    if (elapsedTimeInSeconds >= processingDurationInSeconds) {
      isContinuous = false
    }
  }
}
