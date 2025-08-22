export const createTestChainConfig = (overrides: Partial<any> = {}) => {
  return {
    name: 'Test Chain',
    chainId: 123456,
    parentChainId: 1,
    confirmPeriodBlocks: 150,
    orbitRpcUrl: 'https://test-chain.io/rpc',
    parentRpcUrl: 'https://mainnet.infura.io/v3/test',
    ethBridge: {
      bridge: '0x0000000000000000000000000000000000000001',
      inbox: '0x0000000000000000000000000000000000000002',
      outbox: '0x0000000000000000000000000000000000000003',
      rollup: '0x0000000000000000000000000000000000000004',
      sequencerInbox: '0x0000000000000000000000000000000000000005',
    },
    explorerUrl: 'https://test-explorer.io',
    parentExplorerUrl: 'https://etherscan.io',
    isCustom: false,
    severity: 'critical',
    ...overrides,
  }
}