import { ChildNetwork } from './types'

export const getExplorerUrlPrefixes = (childChain: ChildNetwork) => {
  const PARENT_CHAIN_TX_PREFIX = `${childChain.parentExplorerUrl}tx/`
  const PARENT_CHAIN_ADDRESS_PREFIX = `${childChain.parentExplorerUrl}address/`
  const CHILD_CHAIN_TX_PREFIX = `${childChain.explorerUrl}tx/`
  const CHILD_CHAIN_ADDRESS_PREFIX = `${childChain.explorerUrl}address/`

  return {
    PARENT_CHAIN_TX_PREFIX,
    PARENT_CHAIN_ADDRESS_PREFIX,
    CHILD_CHAIN_TX_PREFIX,
    CHILD_CHAIN_ADDRESS_PREFIX,
  }
}
