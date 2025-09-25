import { ethers } from 'ethers'

export function parseAmount(amountStr: string, decimals: number) {
  return ethers.utils.parseUnits(amountStr, decimals)
}