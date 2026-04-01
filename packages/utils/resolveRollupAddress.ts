const bridgeAbi = [
  {
    inputs: [],
    name: 'rollup',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

interface ContractReader {
  readContract(args: {
    address: `0x${string}`
    abi: typeof bridgeAbi
    functionName: 'rollup'
  }): Promise<`0x${string}`>
}

export async function resolveRollupAddress(
  parentClient: ContractReader,
  ethBridge: { bridge: string; rollup: string },
  chainName?: string
): Promise<string> {
  try {
    const onChainRollup = await parentClient.readContract({
      address: ethBridge.bridge as `0x${string}`,
      abi: bridgeAbi,
      functionName: 'rollup',
    })

    if (onChainRollup.toLowerCase() !== ethBridge.rollup.toLowerCase()) {
      console.warn(
        `[${chainName ?? 'unknown'}] Rollup address mismatch: ` +
          `config=${ethBridge.rollup}, on-chain=${onChainRollup}. Using on-chain value.`
      )
    }

    return onChainRollup
  } catch (error) {
    console.warn(
      `[${chainName ?? 'unknown'}] Failed to resolve rollup from bridge (${ethBridge.bridge}), ` +
        `falling back to config value. Error: ${error instanceof Error ? error.message : error}`
    )
    return ethBridge.rollup
  }
}
