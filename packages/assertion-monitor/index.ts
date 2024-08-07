import { AbiEvent } from 'abitype'
import * as fs from 'fs'
import * as path from 'path'
import { PublicClient, createPublicClient, http } from 'viem'
import yargs from 'yargs'
import { ChildNetwork as ChainInfo } from '../utils'
import {
  getChainFromId,
  getParentChainBlockTimeForBatchPosting,
} from './chains'
import { reportAssertionMonitorErrorToSlack } from './reportAssertionMonitorAlertToSlack'

const options = yargs(process.argv.slice(2))
  .options({
    fromBlock: { type: 'number', default: 0 },
    toBlock: { type: 'number', default: 0 },
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

const getBlockRange = async (
  client: PublicClient,
  childChainInfo: ChainInfo
) => {
  const latestBlockNumber = await client.getBlockNumber()
  const toBlock = BigInt(options.toBlock) || latestBlockNumber

  if (options.fromBlock) {
    return { fromBlock: BigInt(options.fromBlock), toBlock }
  }

  const oneWeekInSeconds = 7 * 24 * 60 * 60
  const blockTime = getParentChainBlockTimeForBatchPosting(childChainInfo)
  const fromBlock = await client.getBlock({
    blockNumber: latestBlockNumber - BigInt(oneWeekInSeconds / blockTime),
  })
  return { fromBlock: fromBlock.number, toBlock }
}

const monitorNodeCreatedEvents = async (childChainInfo: ChainInfo) => {
  const parentChain = getChainFromId(childChainInfo.parentChainId)
  const client = createPublicClient({
    chain: parentChain,
    transport: http(childChainInfo.parentRpcUrl),
  }) as any
  const { fromBlock, toBlock } = await getBlockRange(client, childChainInfo)

  const logs = await client.getLogs({
    address: childChainInfo.ethBridge.rollup as `0x${string}`,
    event: nodeCreatedEventAbi,
    fromBlock,
    toBlock,
  })

  if (!logs || logs.length === 0) {
    return {
      chainName: childChainInfo.name,
      alertMessage: `No assertion events found on ${childChainInfo.name} in the last 7 days.`,
    }
  } else {
    console.log(
      `Found ${logs.length} assertion events on ${childChainInfo.name} in the last 7 days.`
    )
    return null
  }
}

const main = async () => {
  try {
    const alerts: { chainName: string; alertMessage: string }[] = []

    for (const chainInfo of config.childChains) {
      const result = await monitorNodeCreatedEvents(chainInfo)
      if (result) {
        alerts.push(result)
      }
    }

    if (alerts.length > 0) {
      const summaryMessage = alerts
        .map(alert => `- ${alert.alertMessage}`)
        .join('\n')

      const alertMessage = `Assertion Alert Summary:\n${summaryMessage}`
      console.error(alertMessage)

      if (options.enableAlerting) {
        await reportAssertionMonitorErrorToSlack({ message: alertMessage })
      }
    } else {
      console.log('No alerts generated for any chains.')
    }
  } catch (e) {
    const errorStr = `Error processing chain data for assertion monitoring: ${e.message}`
    if (options.enableAlerting) {
      reportAssertionMonitorErrorToSlack({ message: errorStr })
    }
    console.error(errorStr)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
