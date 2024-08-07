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
