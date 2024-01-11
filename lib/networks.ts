export enum ChainId {
    // L1
    Ethereum = 1,
    // L1 Testnets
    Goerli = 5,
    Local = 1337,
    Sepolia = 11155111,
    // L2
    ArbitrumOne = 42161,
    ArbitrumNova = 42170,
    // L2 Testnets
    ArbitrumGoerli = 421613,
    ArbitrumSepolia = 421614,
    ArbitrumLocal = 412346,
    // Orbit Testnets
    XaiTestnet = 47279324479,
    Xai = 660279,
  }
  



  export interface TokenBridge {
    l1GatewayRouter: string
    l2GatewayRouter: string
    l1ERC20Gateway: string
    l2ERC20Gateway: string
    l1CustomGateway: string
    l2CustomGateway: string
    l1WethGateway: string
    l2WethGateway: string
    l2Weth: string
    l1Weth: string
    l1ProxyAdmin: string
    l2ProxyAdmin: string
    l1MultiCall: string
    l2Multicall: string
  }
  
  export interface EthBridge {
    bridge: string
    inbox: string
    sequencerInbox: string
    outbox: string
    rollup: string
    classicOutboxes?: {
      [addr: string]: number
    }
  }

 



  export interface L2Network {
    chainID: number
    name: string
    explorerUrl: string
    gif?: string
    blockTime: number
    isCustom: boolean
    tokenBridge: TokenBridge
    ethBridge: EthBridge
    partnerChainIDs: number[]
    partnerChainID: number
    isArbitrum: true
    confirmPeriodBlocks: number
    retryableLifetimeSeconds: number
    nitroGenesisBlock: number
    nitroGenesisL1Block: number
    nativeToken: string
    depositTimeout: number
   
  }

  export const xai: L2Network = {
    chainID: ChainId.Xai,
    confirmPeriodBlocks: 45818,
    ethBridge: {
      bridge: '0x7dd8A76bdAeBE3BBBaCD7Aa87f1D4FDa1E60f94f',
      inbox: '0xaE21fDA3de92dE2FDAF606233b2863782Ba046F9',
      outbox: '0x1E400568AD4840dbE50FB32f306B842e9ddeF726',
      rollup: '0xC47DacFbAa80Bd9D8112F4e8069482c2A3221336',
      sequencerInbox: '0x995a9d3ca121D48d21087eDE20bc8acb2398c8B1',
    },
    nativeToken: '0x4Cb9a7AE498CEDcBb5EAe9f25736aE7d428C9D66',
    explorerUrl: 'https://explorer.xai-chain.net',
    isArbitrum: true,
    isCustom: true,
    blockTime: 10,
    name: 'Xai',
    partnerChainIDs: [ChainId.ArbitrumOne],
    partnerChainID: ChainId.ArbitrumOne,
    retryableLifetimeSeconds: 604800,
    tokenBridge: {
      l1CustomGateway: '0xb15A0826d65bE4c2fDd961b72636168ee70Af030',
      l1ERC20Gateway: '0xb591cE747CF19cF30e11d656EB94134F523A9e77',
      l1GatewayRouter: '0x22CCA5Dc96a4Ac1EC32c9c7C5ad4D66254a24C35',
      l1MultiCall: '0x842eC2c7D803033Edf55E478F461FC547Bc54EB2',
      l1ProxyAdmin: '0x041f85dd87c46b941dc9b15c6628b19ee5358485',
      l1Weth: '0x0000000000000000000000000000000000000000',
      l1WethGateway: '0x0000000000000000000000000000000000000000',
      l2CustomGateway: '0x96551194230725c72ACF8E9573B1382CCBC70635',
      l2ERC20Gateway: '0x0c71417917D24F4A6A6A55559B98c5cCEcb33F7a',
      l2GatewayRouter: '0xd096e8dE90D34de758B0E0bA4a796eA2e1e272cF',
      l2Multicall: '0xEEC168551A85911Ec3A905e0561b656979f3ea67',
      l2ProxyAdmin: '0x56800fDCFbE19Ea3EE9d115dAC30d95d6459c44E',
      l2Weth: '0x0000000000000000000000000000000000000000',
      l2WethGateway: '0x0000000000000000000000000000000000000000',
    },
    nitroGenesisBlock: 0,
    nitroGenesisL1Block: 0,
    depositTimeout: 1800000,
  }
  

  
