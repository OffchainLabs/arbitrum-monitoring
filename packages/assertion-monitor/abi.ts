export const nodeCreatedEventAbi = {
  type: 'event',
  name: 'NodeCreated',
  inputs: [
    {
      type: 'uint64',
      name: 'nodeNum',
      indexed: true,
    },
    {
      type: 'bytes32',
      name: 'parentNodeHash',
      indexed: true,
    },
    {
      type: 'bytes32',
      name: 'nodeHash',
      indexed: true,
    },
    {
      type: 'bytes32',
      name: 'executionHash',
      indexed: false,
    },
    {
      type: 'tuple',
      name: 'assertion',
      components: [
        {
          type: 'tuple',
          name: 'beforeState',
          components: [
            {
              type: 'tuple',
              name: 'globalState',
              components: [
                {
                  type: 'bytes32[2]',
                  name: 'bytes32Vals',
                },
                {
                  type: 'uint64[2]',
                  name: 'u64Vals',
                },
              ],
            },
            {
              type: 'uint8',
              name: 'machineStatus',
            },
          ],
        },
        {
          type: 'tuple',
          name: 'afterState',
          components: [
            {
              type: 'tuple',
              name: 'globalState',
              components: [
                {
                  type: 'bytes32[2]',
                  name: 'bytes32Vals',
                },
                {
                  type: 'uint64[2]',
                  name: 'u64Vals',
                },
              ],
            },
            {
              type: 'uint8',
              name: 'machineStatus',
            },
          ],
        },
        {
          type: 'uint64',
          name: 'numBlocks',
        },
      ],
      indexed: false,
    },
    {
      type: 'bytes32',
      name: 'afterInboxBatchAcc',
      indexed: false,
    },
    {
      type: 'bytes32',
      name: 'wasmModuleRoot',
      indexed: false,
    },
    {
      type: 'uint256',
      name: 'inboxMaxCount',
      indexed: false,
    },
  ],
} as const

export const nodeConfirmedEventAbi = {
  type: 'event',
  name: 'NodeConfirmed',
  inputs: [
    {
      type: 'uint64',
      name: 'nodeNum',
      indexed: true,
    },
    {
      type: 'bytes32',
      name: 'blockHash',
      indexed: true,
    },
    {
      type: 'bytes32',
      name: 'sendRoot',
      indexed: false,
    },
  ],
} as const

export const assertionCreatedEventAbi = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'assertionHash',
      type: 'bytes32',
    },
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'parentAssertionHash',
      type: 'bytes32',
    },
    {
      components: [
        {
          components: [
            {
              internalType: 'bytes32',
              name: 'prevPrevAssertionHash',
              type: 'bytes32',
            },
            {
              internalType: 'bytes32',
              name: 'sequencerBatchAcc',
              type: 'bytes32',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'wasmModuleRoot',
                  type: 'bytes32',
                },
                {
                  internalType: 'uint256',
                  name: 'requiredStake',
                  type: 'uint256',
                },
                {
                  internalType: 'address',
                  name: 'challengeManager',
                  type: 'address',
                },
                {
                  internalType: 'uint64',
                  name: 'confirmPeriodBlocks',
                  type: 'uint64',
                },
                {
                  internalType: 'uint64',
                  name: 'nextInboxPosition',
                  type: 'uint64',
                },
              ],
              internalType: 'struct ConfigData',
              name: 'configData',
              type: 'tuple',
            },
          ],
          internalType: 'struct BeforeStateData',
          name: 'beforeStateData',
          type: 'tuple',
        },
      ],
      indexed: false,
      internalType: 'struct AssertionInputs',
      name: 'assertion',
      type: 'tuple',
    },
    {
      indexed: false,
      internalType: 'bytes32',
      name: 'afterInboxBatchAcc',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'inboxMaxCount',
      type: 'uint256',
    },
    {
      indexed: false,
      internalType: 'bytes32',
      name: 'wasmModuleRoot',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'requiredStake',
      type: 'uint256',
    },
    {
      indexed: false,
      internalType: 'address',
      name: 'challengeManager',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'uint64',
      name: 'confirmPeriodBlocks',
      type: 'uint64',
    },
  ],
  name: 'AssertionCreated',
  type: 'event',
} as const

export const assertionConfirmedEventAbi = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'assertionHash',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'bytes32',
      name: 'blockHash',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'bytes32',
      name: 'sendRoot',
      type: 'bytes32',
    },
  ],
  name: 'AssertionConfirmed',
  type: 'event',
} as const

export const rollupABI = [
  {
    inputs: [],
    name: 'validatorWhitelistDisabled',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
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
