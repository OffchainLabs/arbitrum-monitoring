import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config({ path: '../../.env' })

// config.json file at project root
export const DEFAULT_CONFIG_PATH = '../../config.json'

export const getConfig = (options: { configPath: string }): ChildChains => {
  try {
    const configFileContent = fs.readFileSync(
      path.join(process.cwd(), options.configPath),
      'utf-8'
    )

    const parsedConfig = JSON.parse(configFileContent)

    const validatedConfig = validateChildChainsConfig(parsedConfig)

    return validatedConfig
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON in the config file')
    }
    if (error instanceof Error) {
      throw new Error(`Error reading or parsing config file: ${error.message}`)
    }
    throw new Error(
      'An unknown error occurred while processing the config file'
    )
  }
}

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)

export const ChildChainsSchema = z.object({
  childChains: z.array(
    z.object({
      chainId: z.number(),
      confirmPeriodBlocks: z.number(),
      ethBridge: z.object({
        bridge: addressSchema,
        inbox: addressSchema,
        outbox: addressSchema,
        rollup: addressSchema,
        sequencerInbox: addressSchema,
      }),
      nativeToken: addressSchema,
      explorerUrl: z.string().url(),
      rpcUrl: z.string().url(),
      name: z.string(),
      slug: z.string(),
      parentChainId: z.number(),
      retryableLifetimeSeconds: z.number(),
      isCustom: z.boolean(),
      tokenBridge: z.object({
        parentCustomGateway: addressSchema,
        parentErc20Gateway: addressSchema,
        parentGatewayRouter: addressSchema,
        parentMultiCall: addressSchema,
        parentProxyAdmin: addressSchema,
        parentWeth: addressSchema,
        parentWethGateway: addressSchema,
        childCustomGateway: addressSchema,
        childErc20Gateway: addressSchema,
        childGatewayRouter: addressSchema,
        childMultiCall: addressSchema,
        childProxyAdmin: addressSchema,
        childWeth: addressSchema,
        childWethGateway: addressSchema,
      }),
      bridgeUiConfig: z.object({
        color: z.string(),
        network: z.object({
          name: z.string(),
          logo: z.string(),
          description: z.string(),
        }),
        nativeTokenData: z.object({
          name: z.string(),
          symbol: z.string(),
          decimals: z.number(),
          logoUrl: z.string(),
        }),
      }),
      orbitRpcUrl: z.string().url(),
      parentRpcUrl: z.string().url(),
      parentExplorerUrl: z.string().url(),
    })
  ),
})

export type ChildChains = z.infer<typeof ChildChainsSchema>

export function validateChildChainsConfig(obj: unknown): ChildChains {
  return ChildChainsSchema.parse(obj)
}
