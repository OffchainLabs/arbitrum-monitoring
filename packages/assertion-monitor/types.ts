import { Block, Log } from 'viem'
import {
  ASSERTION_CONFIRMED_EVENT,
  ASSERTION_CREATED_EVENT,
  NODE_CONFIRMED_EVENT,
  NODE_CREATED_EVENT,
} from './abi'

export interface BlockRange {
  fromBlock: bigint
  toBlock: bigint
}

export interface AssertionLogs {
  createdLogs: Log[]
  confirmedLogs: Log[]
}

/** Type for assertion/node creation events */
export type CreationEvent = Log<
  bigint,
  number,
  false,
  typeof ASSERTION_CREATED_EVENT | typeof NODE_CREATED_EVENT,
  true
> & {
  args: {
    assertionHash: `0x${string}`
    parentAssertionHash: `0x${string}`
    assertion: {
      wasmModuleRoot: `0x${string}`
      requiredStake: bigint
      challengeManager: `0x${string}`
      confirmPeriodBlocks: bigint
    }
  }
}

/** Type for assertion/node confirmation events */
export type ConfirmationEvent = Log<
  bigint,
  number,
  false,
  typeof ASSERTION_CONFIRMED_EVENT | typeof NODE_CONFIRMED_EVENT,
  true
> & {
  args: {
    blockHash: `0x${string}`
  }
}

/** Chain state information needed for monitoring */
export interface ChainState {
  childCurrentBlock: Block
  childLatestCreatedBlock?: Block
  childLatestConfirmedBlock?: Block
  parentCurrentBlock?: Block
  parentBlockAtCreation?: Block 
  parentBlockAtConfirmation?: Block
  recentCreationEvent: CreationEvent | null
  recentConfirmationEvent: ConfirmationEvent | null
  isValidatorWhitelistDisabled: boolean
  isBaseStakeBelowThreshold: boolean
}
