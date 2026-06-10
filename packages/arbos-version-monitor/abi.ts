export const arbSysAbi = [
  {
    inputs: [],
    name: 'arbOSVersion',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export const rollupAbi = [
  {
    inputs: [],
    name: 'wasmModuleRoot',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const
