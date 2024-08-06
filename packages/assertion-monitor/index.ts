import { AbiEvent } from 'abitype'
import * as fs from 'fs'
import * as path from 'path'
import { PublicClient, createPublicClient, http } from 'viem'
import yargs from 'yargs'
import { ChildNetwork as ChainInfo } from '../utils'
import { getChainFromId } from './chains'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'

const options = yargs(process.argv.slice(2))
  .options({
    configPath: { type: 'string', default: 'config.json' },
    enableAlerting: { type: 'boolean', default: false },
  })
  .strict()
  .parseSync()

const configFileContent = fs.readFileSync(
  path.join(process.cwd(), options.configPath),
  'utf-8'
)
const config = JSON.parse(configFileContent)

if (!Array.isArray(config.childChains) || config.childChains.length === 0) {
  console.error('Error: Chains not found in the config file.')
  process.exit(1)
}
const nodeCreatedEventAbi = {
  type: 'event',
  name: 'NodeCreated',
  inputs: [
    {
      type: 'uint64',
      name: 'nodeNum',
      indexed: true,
    },
    {
      type: 'bytes32',
      name: 'parentNodeHash',
      indexed: true,
    },
    {
      type: 'bytes32',
      name: 'nodeHash',
      indexed: true,
    },
    {
      type: 'bytes32',
      name: 'executionHash',
      indexed: false,
    },
    {
      type: 'tuple',
      name: 'assertion',
      components: [
        {
          type: 'tuple',
          name: 'beforeState',
          components: [
            {
              type: 'tuple',
              name: 'globalState',
              components: [
                {
                  type: 'bytes32[2]',
                  name: 'bytes32Vals',
                },
                {
                  type: 'uint64[2]',
                  name: 'u64Vals',
                },
              ],
            },
            {
              type: 'uint8',
              name: 'machineStatus',
            },
          ],
        },
        {
          type: 'tuple',
          name: 'afterState',
          components: [
            {
              type: 'tuple',
              name: 'globalState',
              components: [
                {
                  type: 'bytes32[2]',
                  name: 'bytes32Vals',
                },
                {
                  type: 'uint64[2]',
                  name: 'u64Vals',
                },
              ],
            },
            {
              type: 'uint8',
              name: 'machineStatus',
            },
          ],
        },
        {
          type: 'uint64',
          name: 'numBlocks',
        },
      ],
      indexed: false,
    },
    {
      type: 'bytes32',
      name: 'afterInboxBatchAcc',
      indexed: false,
    },
    {
      type: 'bytes32',
      name: 'wasmModuleRoot',
      indexed: false,
    },
    {
      type: 'uint256',
      name: 'inboxMaxCount',
      indexed: false,
    },
  ],
} as const

const getLogsForLast7Days = async (
  client: PublicClient,
  address: `0x${string}` | `0x${string}`[],
  abi: AbiEvent
) => {
  const latestBlockNumber = await client.getBlockNumber()
  const oneWeekInSeconds = 7 * 24 * 60 * 60
  const earliestBlock = await client.getBlock({
    blockNumber: latestBlockNumber - BigInt(oneWeekInSeconds / 12),
  }) // assuming average block time of 12 seconds

  return await client.getLogs({
    address,
    event: nodeCreatedEventAbi,
    fromBlock: earliestBlock.number,
    toBlock: latestBlockNumber,
  })
}

const monitorNodeCreatedEvents = async (childChainInformation: ChainInfo) => {
  const parentChain = getChainFromId(childChainInformation.parentChainId)
  const client = createPublicClient({
    chain: parentChain,
    transport: http(childChainInformation.parentRpcUrl),
  }) as any

  const logs = await getLogsForLast7Days(
    client,
    childChainInformation.ethBridge.rollup as `0x${string}`,
    nodeCreatedEventAbi
  )

  if (!logs || logs.length === 0) {
    const alertMessage = `No assertion events found on ${childChainInformation.name} in the last 7 days.`
    console.error(alertMessage)
    if (options.enableAlerting) {
      await reportAssertionMonitorErrorToSlack({ message: alertMessage })
    }
  } else {
    console.log(
      `Found ${logs.length} assertion events on ${childChainInformation.name} in the last 7 days.`
    )
  }
}

const main = async () => {
  for (const childChain of config.childChains) {
    try {
      await monitorNodeCreatedEvents(childChain)
    } catch (e) {
      const errorStr = `Error processing chain [${childChain.name}]: ${e.message}`
      if (options.enableAlerting) {
        reportAssertionMonitorErrorToSlack({ message: errorStr })
      }
      console.error(errorStr)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
