// import { ArbGasInfo__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ArbGasInfo__factory'
// import { ArbRetryableTx__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ArbRetryableTx__factory'

// import {
//   ARB_GAS_INFO,
//   ARB_RETRYABLE_TX_ADDRESS,
// } from '@arbitrum/sdk/dist/lib/dataEntities/constants'
// import { getEnv } from './getEnv'
// import { BigNumber, ethers } from 'ethers'
// import axios from 'axios'
// import { providers } from 'ethers'
// import { Chain } from './constants'

// // https://eips.ethereum.org/EIPS/eip-1967
// const LOGIC_SLOT =
//   '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'

// /**
//  * Call precompiles to get info about gas price and gas estimation for the TX execution.
//  *
//  * @param createdAtBlockNumber
//  * @param txData
//  * @returns
//  */
// export async function getGasInfo(
//   createdAtBlockNumber: number,
//   ticketId: string
// ): Promise<{
//   l2GasPrice: BigNumber
//   l2GasPriceAtCreation: BigNumber
//   redeemEstimate: BigNumber | undefined
// }> {
//   const { l2Provider } = await getEnv()

//   // connect precompiles
//   const arbGasInfo = ArbGasInfo__factory.connect(ARB_GAS_INFO, l2Provider)
//   const retryablePrecompile = ArbRetryableTx__factory.connect(
//     ARB_RETRYABLE_TX_ADDRESS,
//     l2Provider
//   )

//   // get current gas price
//   const gasComponents = await arbGasInfo.callStatic.getPricesInWei()
//   const l2GasPrice = gasComponents[5]

//   // get gas price when retryable was created
//   const gasComponentsAtCreation = await arbGasInfo.callStatic.getPricesInWei({
//     blockTag: createdAtBlockNumber,
//   })
//   const l2GasPriceAtCreation = gasComponentsAtCreation[5]

//   // get gas estimation for redeem
//   let redeemEstimate = undefined
//   try {
//     redeemEstimate = await retryablePrecompile.estimateGas.redeem(ticketId)
//   } catch {}

//   return { l2GasPrice, l2GasPriceAtCreation, redeemEstimate }
// }

// export async function decodeCalldata(
//   txData: string,
//   destination: string
// ): Promise<string | undefined> {
//   const retryableSelector = txData.substring(0, 10)

//   /// first try samczsun DB
//   try {
//     // 0x + 4bytes
//     const url = `https://sig.eth.samczsun.com/api/v1/signatures?function=${retryableSelector}`
//     const response = await axios.get(url)
//     return response.data.result.function[retryableSelector][0].name
//   } catch {}

//   /// then try finding match within ABI fetched from Etherscan
//   try {
//     const arbiscanApiKey = process.env.ARBISCAN_API_KEY
//     if (arbiscanApiKey === undefined) {
//       return undefined
//     }

//     /// get abi and try to match selector
//     const url = `https://api.arbiscan.io/api?module=contract&action=getabi&address=${destination}&apikey=${arbiscanApiKey}`
//     const response = await axios.get(url)
//     const abi = JSON.parse(response.data.result)
//     let decodedFunctionName = await _matchSelectorToFunctionSig(
//       abi,
//       retryableSelector
//     )
//     if (decodedFunctionName !== undefined) {
//       return decodedFunctionName
//     }

//     /// then try finding match within logic contract's ABI fetched from Etherscan
//     const { l2Provider } = await getEnv()
//     const logicContractAddress = await _getLogicContractAddress(
//       destination,
//       l2Provider
//     )
//     if (logicContractAddress === ethers.constants.AddressZero) {
//       return undefined
//     }
//     const logicUrl = `https://api.arbiscan.io/api?module=contract&action=getabi&address=${logicContractAddress}&apikey=${arbiscanApiKey}`
//     const logicResponse = await axios.get(logicUrl)
//     const logicAbi = JSON.parse(logicResponse.data.result)
//     decodedFunctionName = await _matchSelectorToFunctionSig(
//       logicAbi,
//       retryableSelector
//     )
//     if (decodedFunctionName !== undefined) {
//       return decodedFunctionName
//     }
//   } catch {}

//   return undefined
// }

// /**
//  * Get TX failure reason by scraping arbiscan
//  * @param txHash
//  * @returns
//  */
// export async function getFailureReason(
//   txHash: string
// ): Promise<string | undefined> {
//   const url = `https://arbiscan.io/tx/${txHash}`

//   try {
//     const response = await axios.get(url)
//     const content = response.data

//     // match the 'Fail' regex
//     const matchFail = content.match(/>(Fail[^<]+)<\//)
//     if (matchFail && matchFail[1]) {
//       return matchFail[1]
//     }

//     // Use a regular expression to extract the desired substring
//     const matchError = content.match(
//       /Error encountered during contract execution \[<strong>([^<]+)<\/strong>\]/
//     )
//     if (matchError && matchError[1]) {
//       return matchError[1]
//     }
//   } catch {}

//   return undefined
// }

// /**
//  * Get contract name from preparsed labels, Etherscan, Arbiscan or ENS
//  * @param chain
//  * @param contractAddress
//  * @returns
//  */
// export async function getContractName(
//   chain: Chain,
//   contractAddress: string
// ): Promise<string | undefined> {
//   if (contractAddress === '') {
//     return ''
//   }

//   const contractName = await _getContractNameFromExplorer(
//     chain,
//     contractAddress
//   )
//   if (contractName !== undefined) {
//     return contractName
//   }

//   const ensName = await _ensLookup(contractAddress, chain)
//   if (ensName !== undefined) {
//     return ensName
//   }

//   // const label = _searchLabels(chain, contractAddress)
//   // if (label !== undefined) {
//   //   return label
//   // }

//   return contractAddress
// }

// async function _getContractNameFromExplorer(
//   chain: Chain,
//   contractAddress: string
// ): Promise<string | undefined> {
//   try {
//     if (chain == Chain.ETHEREUM) {
//       // get API key
//       const etherscanApiKey = process.env.ETHERSCAN_API_KEY
//       if (etherscanApiKey === undefined) {
//         return undefined
//       }

//       // first find logic contract address
//       const { l1Provider } = await getEnv()
//       while (true) {
//         const logicContract = await _getLogicContractAddress(
//           contractAddress,
//           l1Provider
//         )
//         if (logicContract === ethers.constants.AddressZero) {
//           break
//         } else {
//           contractAddress = logicContract
//         }
//       }

//       // get contract name from etherscan
//       const url = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${etherscanApiKey}`
//       const response = await axios.get(url)
//       const data = response.data.result[0]
//       if (data !== undefined && data.ContractName !== '') {
//         return data.ContractName
//       }
//     }

//     if (chain == Chain.ARBITRUM) {
//       // get API key
//       const arbiscanApiKey = process.env.ARBISCAN_API_KEY
//       if (arbiscanApiKey === undefined) {
//         return undefined
//       }

//       // find logic contract address
//       const { l2Provider } = await getEnv()
//       while (true) {
//         const logicContract = await _getLogicContractAddress(
//           contractAddress,
//           l2Provider
//         )
//         if (logicContract === ethers.constants.AddressZero) {
//           break
//         } else {
//           contractAddress = logicContract
//         }
//       }

//       // get contract name from arbiscan
//       const url = `https://api.arbiscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${arbiscanApiKey}`
//       const response = await axios.get(url)
//       const data = response.data.result[0]
//       if (data !== undefined && data.ContractName !== '') {
//         return data.ContractName
//       }
//     }
//   } catch {}

//   return undefined
// }

// async function _ensLookup(
//   account: string,
//   chain: Chain
// ): Promise<string | undefined> {
//   try {
//     /// get correct provider
//     const { l1Provider, l2Provider } = await getEnv()

//     let provider
//     if (chain == Chain.ETHEREUM) {
//       provider = l1Provider
//     } else if (chain == Chain.ARBITRUM) {
//       provider = l2Provider
//     } else {
//       return undefined
//     }

//     /// lookup

//     const ensName = await provider.lookupAddress(account)
//     if (ensName !== null && ensName != '') {
//       return ensName
//     }
//   } catch {}

//   return undefined
// }

// /**
//  * Send ping to healthchecks.io
//  * @param pingUrl
//  */
// export async function sendHealthCheck(pingUrl: string): Promise<void> {
//   try {
//     await axios.get(pingUrl)
//   } catch {}
// }

// async function _getLogicContractAddress(
//   proxyAddress: string,
//   provider: providers.JsonRpcProvider
// ): Promise<string> {
//   const logicWord = await provider.getStorageAt(proxyAddress, LOGIC_SLOT)
//   const logicAddress = '0x' + logicWord.slice(-40)
//   return logicAddress
// }

// /**
//  * Go through ABI and try to match selector to function signature.
//  * @param abi
//  * @param targetSelector
//  * @returns function signature or undefined
//  */
// async function _matchSelectorToFunctionSig(
//   abi: any,
//   targetSelector: string
// ): Promise<string | undefined> {
//   for (const item of abi) {
//     if (item.type === 'function') {
//       const functionSig = `${item.name}(${item.inputs
//         .map((i: { type: string }) => i.type)
//         .join(',')})`
//       const selector = ethers.utils
//         .keccak256(ethers.utils.toUtf8Bytes(functionSig))
//         .slice(0, 10)

//       if (selector == targetSelector) {
//         return functionSig
//       }
//     }
//   }

//   return undefined
// }
