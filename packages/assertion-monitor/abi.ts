import { parseAbiItem } from 'viem'

export const rollupABI = [
  {
    inputs: [],
    name: 'validatorWhitelistDisabled',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    type: 'event',
    name: 'AssertionCreated',
    inputs: [
      { indexed: true, name: 'assertionHash', type: 'bytes32' },
      { indexed: true, name: 'parentAssertionHash', type: 'bytes32' },
      {
        name: 'assertion',
        type: 'tuple',
        components: [
          {
            name: 'beforeState',
            type: 'tuple',
            components: [
              { name: 'prevPrevAssertionHash', type: 'bytes32' },
              { name: 'sequencerBatchAcc', type: 'bytes32' },
              {
                name: 'config',
                type: 'tuple',
                components: [
                  { name: 'wasmModuleRoot', type: 'bytes32' },
                  { name: 'requiredStake', type: 'uint256' },
                  { name: 'challengeManager', type: 'address' },
                  { name: 'confirmPeriodBlocks', type: 'uint64' },
                  { name: 'nextInboxPosition', type: 'uint64' }
                ]
              }
            ]
          },
          {
            name: 'beforeStateSnapshot',
            type: 'tuple',
            components: [
              {
                name: 'globalState',
                type: 'tuple',
                components: [
                  { name: 'bytes32Vals', type: 'bytes32[2]' },
                  { name: 'u64Vals', type: 'uint64[2]' }
                ]
              },
              { name: 'machineStatus', type: 'uint8' },
              { name: 'endHistoryRoot', type: 'bytes32' }
            ]
          },
          {
            name: 'afterStateSnapshot',
            type: 'tuple',
            components: [
              {
                name: 'globalState',
                type: 'tuple',
                components: [
                  { name: 'bytes32Vals', type: 'bytes32[2]' },
                  { name: 'u64Vals', type: 'uint64[2]' }
                ]
              },
              { name: 'machineStatus', type: 'uint8' },
              { name: 'endHistoryRoot', type: 'bytes32' }
            ]
          }
        ]
      },
      { name: 'afterInboxBatchAcc', type: 'bytes32' },
      { name: 'inboxMaxCount', type: 'uint256' },
      { name: 'wasmModuleRoot', type: 'bytes32' },
      { name: 'requiredStake', type: 'uint256' },
      { name: 'challengeManager', type: 'address' },
      { name: 'confirmPeriodBlocks', type: 'uint64' }
    ]
  },
  {
    type: 'event',
    name: 'AssertionConfirmed',
    inputs: [
      { indexed: true, name: 'assertionHash', type: 'bytes32' },
      { name: 'blockHash', type: 'bytes32' },
      { name: 'sendRoot', type: 'bytes32' }
    ]
  },
  {
    type: 'event',
    name: 'NodeCreated',
    inputs: [
      { indexed: true, name: 'nodeNum', type: 'uint64' },
      { indexed: true, name: 'parentNodeHash', type: 'bytes32' },
      { indexed: true, name: 'nodeHash', type: 'bytes32' },
      { name: 'executionHash', type: 'bytes32' },
      { name: 'assertion', type: 'tuple', components: [
        { name: 'beforeState', type: 'tuple', components: [
          { name: 'globalState', type: 'tuple', components: [
            { name: 'bytes32Vals', type: 'bytes32[2]' },
            { name: 'u64Vals', type: 'uint64[2]' }
          ]},
          { name: 'machineStatus', type: 'uint8' }
        ]},
        { name: 'afterState', type: 'tuple', components: [
          { name: 'globalState', type: 'tuple', components: [
            { name: 'bytes32Vals', type: 'bytes32[2]' },
            { name: 'u64Vals', type: 'uint64[2]' }
          ]},
          { name: 'machineStatus', type: 'uint8' }
        ]},
        { name: 'numBlocks', type: 'uint64' }
      ]},
      { name: 'afterInboxBatchAcc', type: 'bytes32' },
      { name: 'wasmModuleRoot', type: 'bytes32' },
      { name: 'inboxMaxCount', type: 'uint256' }
    ]
  },
  {
    type: 'event',
    name: 'NodeConfirmed',
    inputs: [
      { indexed: true, name: 'nodeNum', type: 'uint64' },
      { name: 'blockHash', type: 'bytes32' },
      { name: 'sendRoot', type: 'bytes32' }
    ]
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
