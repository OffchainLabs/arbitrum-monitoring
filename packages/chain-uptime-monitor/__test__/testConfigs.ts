import { ChildNetwork } from '../../utils'

export const createTestChainConfig = (
  overrides?: Partial<ChildNetwork>
): ChildNetwork => ({
  name: 'Test Chain',
  chainId: 421614,
  parentChainId: 11155111,
  confirmPeriodBlocks: 45818,
  isCustom: false,
  parentRpcUrl: 'https://sepolia.drpc.org',
  orbitRpcUrl: 'https://test-chain-rpc.com',
  explorerUrl: 'https://test-explorer.com',
  parentExplorerUrl: 'https://sepolia.etherscan.io',
  ethBridge: {
    bridge: '0x38f918D0E9F1b721EDaA41302E399fa1B79333a9',
    inbox: '0xaAe29B0366299461418F5324a79Afc425BE5ae21',
    outbox: '0x65f07C7D521164a4d5DaC6eB8Fac8DA067A3B78F',
    rollup: '0x042b2e6c5e99d4c521bd49beed5e99651d9b0cf4',
    sequencerInbox: '0x6c97864CE4bE1C2C8bB6aFe3A115E6D7Dca82E71',
  },
  ...overrides,
})

export const createTestChains = (): ChildNetwork[] => [
  createTestChainConfig({
    name: 'Chain 1',
    chainId: 1001,
    orbitRpcUrl: 'https://chain1-rpc.com',
  }),
  createTestChainConfig({
    name: 'Chain 2',
    chainId: 1002,
    orbitRpcUrl: 'https://chain2-rpc.com',
  }),
  createTestChainConfig({
    name: 'Chain 3',
    chainId: 1003,
    orbitRpcUrl: 'https://chain3-rpc.com',
  }),
  createTestChainConfig({
    name: 'Chain 4',
    chainId: 1004,
    orbitRpcUrl: 'https://chain4-rpc.com',
  }),
]
