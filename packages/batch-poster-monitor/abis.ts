import { AbiEvent } from 'abitype'

export const sequencerBatchDeliveredEventAbi: AbiEvent = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'uint256',
      name: 'batchSequenceNumber',
      type: 'uint256',
    },
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'beforeAcc',
      type: 'bytes32',
    },
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'afterAcc',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'bytes32',
      name: 'delayedAcc',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'afterDelayedMessagesRead',
      type: 'uint256',
    },
    {
      components: [
        { internalType: 'uint64', name: 'minTimestamp', type: 'uint64' },
        { internalType: 'uint64', name: 'maxTimestamp', type: 'uint64' },
        { internalType: 'uint64', name: 'minBlockNumber', type: 'uint64' },
        { internalType: 'uint64', name: 'maxBlockNumber', type: 'uint64' },
      ],
      indexed: false,
      internalType: 'struct ISequencerInbox.TimeBounds',
      name: 'timeBounds',
      type: 'tuple',
    },
    {
      indexed: false,
      internalType: 'enum ISequencerInbox.BatchDataLocation',
      name: 'dataLocation',
      type: 'uint8',
    },
  ],
  name: 'SequencerBatchDelivered',
  type: 'event',
}

export const sequencerInboxAbi = [
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'sequenceNumber',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
      {
        internalType: 'uint256',
        name: 'afterDelayedMessagesRead',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: 'gasRefunder',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'prevMessageCount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'newMessageCount',
        type: 'uint256',
      },
    ],
    name: 'addSequencerL2BatchFromOrigin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Espresso variant (selector 0x37501551) — 7th param for TEE attestation
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'sequenceNumber',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
      {
        internalType: 'uint256',
        name: 'afterDelayedMessagesRead',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: 'gasRefunder',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'prevMessageCount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'newMessageCount',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'batcherSignatureAndHotshotHeight',
        type: 'bytes',
      },
    ],
    name: 'addSequencerL2BatchFromOrigin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Bold DelayProof variant (selector 0x69cacded) — 7th param is DelayProof struct
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'sequenceNumber',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
      {
        internalType: 'uint256',
        name: 'afterDelayedMessagesRead',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: 'gasRefunder',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'prevMessageCount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'newMessageCount',
        type: 'uint256',
      },
      {
        components: [
          {
            internalType: 'bytes32',
            name: 'beforeDelayedAcc',
            type: 'bytes32',
          },
          {
            components: [
              {
                internalType: 'uint8',
                name: 'kind',
                type: 'uint8',
              },
              {
                internalType: 'address',
                name: 'sender',
                type: 'address',
              },
              {
                internalType: 'uint64',
                name: 'blockNumber',
                type: 'uint64',
              },
              {
                internalType: 'uint64',
                name: 'timestamp',
                type: 'uint64',
              },
              {
                internalType: 'uint256',
                name: 'inboxSeqNum',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'baseFeeL1',
                type: 'uint256',
              },
              {
                internalType: 'bytes32',
                name: 'messageDataHash',
                type: 'bytes32',
              },
            ],
            internalType: 'struct Messages.Message',
            name: 'message',
            type: 'tuple',
          },
        ],
        internalType: 'struct ISequencerInbox.DelayProof',
        name: 'delayProof',
        type: 'tuple',
      },
    ],
    name: 'addSequencerL2BatchFromOriginDelayProof',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const
