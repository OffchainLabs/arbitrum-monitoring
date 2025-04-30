/*
  Logic for fetching the deposits initiated and message delivered events from the parent chain
*/

import { Provider } from '@ethersproject/abstract-provider'
import { EventFetcher } from '@arbitrum/sdk'
import { Bridge__factory } from '@arbitrum/sdk/dist/lib/abi/factories/Bridge__factory'
import { L1ERC20Gateway__factory } from '@arbitrum/sdk/dist/lib/abi/factories/L1ERC20Gateway__factory'
import { DepositInitiatedEvent } from '@arbitrum/sdk/dist/lib/abi/L1ERC20Gateway'

export const getDepositInitiatedEventData = async (
  parentChainGatewayAddress: string,
  filter: {
    fromBlock: number
    toBlock: number
  },
  parentChainProvider: Provider
) => {
  const eventFetcher = new EventFetcher(parentChainProvider)
  const logs = await eventFetcher.getEvents<any, DepositInitiatedEvent>(
    L1ERC20Gateway__factory,
    (g: any) => g.filters.DepositInitiated(),
    {
      ...filter,
      address: parentChainGatewayAddress,
    }
  )

  return logs
}

export const getMessageDeliveredEventData = async (
  parentBridgeAddress: string,
  filter: {
    fromBlock: number
    toBlock: number
  },
  parentChainProvider: Provider
) => {
  const eventFetcher = new EventFetcher(parentChainProvider)
  const logs = await eventFetcher.getEvents(
    Bridge__factory,
    (g: any) => g.filters.MessageDelivered(),
    { ...filter, address: parentBridgeAddress }
  )

  // Filter logs where event.kind is equal to 9
  // https://github.com/OffchainLabs/nitro-contracts/blob/38a70a5e14f8b52478eb5db08e7551a82ced14fe/src/libraries/MessageTypes.sol#L9
  const filteredLogs = logs.filter(log => log.event.kind === 9)

  return filteredLogs
}

export const getDepositInitiatedLogs = async ({
  fromBlock,
  toBlock,
  parentChainProvider,
  gatewayAddresses,
}: {
  fromBlock: number
  toBlock: number
  parentChainProvider: Provider
  gatewayAddresses: {
    parentErc20Gateway: string
    parentCustomGateway: string
    parentWethGateway: string
  }
}) => {
  const [
    depositsInitiatedLogsL1Erc20Gateway,
    depositsInitiatedLogsL1CustomGateway,
    depositsInitiatedLogsL1WethGateway,
  ] = await Promise.all(
    [
      gatewayAddresses.parentErc20Gateway,
      gatewayAddresses.parentCustomGateway,
      gatewayAddresses.parentWethGateway,
    ].map(gatewayAddress => {
      return getDepositInitiatedEventData(
        gatewayAddress,
        { fromBlock, toBlock },
        parentChainProvider
      )
    })
  )

  return [
    ...depositsInitiatedLogsL1Erc20Gateway,
    ...depositsInitiatedLogsL1CustomGateway,
    ...depositsInitiatedLogsL1WethGateway,
  ]
}
