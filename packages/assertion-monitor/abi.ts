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
