import { parseAbiItem } from 'viem'

export const rollupABI = [
  {
    inputs: [],
    name: 'validatorWhitelistDisabled',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  }
] as const

export const boldABI = [
  {
    inputs: [],
    name: 'genesisAssertionHash',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'baseStake',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export const ASSERTION_CREATED_EVENT = {
  ...parseAbiItem(
    'event AssertionCreated(bytes32 indexed assertionHash, bytes32 indexed parentAssertionHash, ((bytes32 prevPrevAssertionHash, bytes32 sequencerBatchAcc, (bytes32 wasmModuleRoot, uint256 requiredStake, address challengeManager, uint64 confirmPeriodBlocks, uint64 nextInboxPosition)), ((bytes32[2] globalStateBytes32Vals, uint64[2] globalStateU64Vals), uint8 beforeStateMachineStatus, bytes32 beforeStateEndHistoryRoot), ((bytes32[2] globalStateBytes32Vals, uint64[2] globalStateU64Vals), uint8 afterStateMachineStatus, bytes32 afterStateEndHistoryRoot)) assertion, bytes32 afterInboxBatchAcc, uint256 inboxMaxCount, bytes32 wasmModuleRoot, uint256 requiredStake, address challengeManager, uint64 confirmPeriodBlocks)'
  ),
  name: 'AssertionCreated',
  type: 'event',
} as const

export const ASSERTION_CONFIRMED_EVENT = {
  ...parseAbiItem(
    'event AssertionConfirmed(bytes32 indexed assertionHash, bytes32 blockHash, bytes32 sendRoot)'
  ),
  name: 'AssertionConfirmed',
  type: 'event',
} as const

export const NODE_CREATED_EVENT = {
  ...parseAbiItem(
    'event NodeCreated(uint64 indexed nodeNum, bytes32 indexed parentNodeHash, bytes32 indexed nodeHash, bytes32 executionHash, (((bytes32[2] bytes32Vals, uint64[2] u64Vals) globalState, uint8 machineStatus) beforeState, ((bytes32[2] bytes32Vals, uint64[2] u64Vals) globalState, uint8 machineStatus) afterState, uint64 numBlocks) assertion, bytes32 afterInboxBatchAcc, bytes32 wasmModuleRoot, uint256 inboxMaxCount)'
  ),
  name: 'NodeCreated',
  type: 'event',
} as const

export const NODE_CONFIRMED_EVENT = {
  ...parseAbiItem(
    'event NodeConfirmed(uint64 indexed nodeNum, bytes32 blockHash, bytes32 sendRoot)'
  ),
  name: 'NodeConfirmed',
  type: 'event',
} as const
