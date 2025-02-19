// Test chain configurations
export const boldChainInfo = {
  name: 'Arbitrum Sepolia',
  chainId: 421614,
  parentChainId: 11155111,
  confirmPeriodBlocks: 45818,
  parentRpcUrl: 'https://sepolia.drpc.org',
  orbitRpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
  ethBridge: {
    bridge: '0x38f918D0E9F1b721EDaA41302E399fa1B79333a9',
    inbox: '0xaAe29B0366299461418F5324a79Afc425BE5ae21',
    outbox: '0x65f07C7D521164a4d5DaC6eB8Fac8DA067A3B78F',
    rollup: '0x042b2e6c5e99d4c521bd49beed5e99651d9b0cf4',
    sequencerInbox: '0x6c97864CE4bE1C2C8bB6aFe3A115E6D7Dca82E71',
  },
  explorerUrl: 'https://sepolia.arbiscan.io',
  parentExplorerUrl: 'https://sepolia.etherscan.io',
  isCustom: false,
  severity: 'critical',
}

export const classicChainInfo = {
  name: 'Xai Testnet',
  chainId: 37714555429,
  parentChainId: 421614,
  confirmPeriodBlocks: 150,
  parentRpcUrl: 'https://arbitrum-sepolia.drpc.org',
  orbitRpcUrl: 'https://testnet-v2.xai-chain.net/rpc',
  ethBridge: {
    bridge: '0x6c7FAC4edC72E86B3388B48979eF37Ecca5027e6',
    inbox: '0x6396825803B720bc6A43c63caa1DcD7B31EB4dd0',
    outbox: '0xc7491a559b416540427f9f112C5c98b1412c5d51',
    rollup: '0xeedE9367Df91913ab149e828BDd6bE336df2c892',
    sequencerInbox: '0x529a2061A1973be80D315770bA9469F3Da40D938',
  },
  explorerUrl: 'https://testnet-explorer-v2.xai-chain.net',
  parentExplorerUrl: 'https://sepolia.arbiscan.io',
  isCustom: false,
  severity: 'critical',
} 