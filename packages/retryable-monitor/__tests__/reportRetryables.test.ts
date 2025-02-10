import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { formatL2Callvalue } from '../reportRetryables'
import { ChildChainTicketReport } from '../types'

describe('reportRetryables', () => {
  describe('formatL2Callvalue', () => {
    it('should format ETH amounts correctly', async () => {
      const ticket = {
        deposit: {
          amount: ethers.utils.parseEther('12.0').toString(),
          symbol: 'ETH',
          decimals: 18,
        },
      } as ChildChainTicketReport

      const result = await formatL2Callvalue(ticket)
      expect(result).toBe('\n\t *Child chain callvalue:* 12.0 ETH')
    })

    it('should format USDC amounts with 6 decimals', async () => {
      const ticket = {
        deposit: {
          amount: '12000000', // 12 USDC with 6 decimals
          symbol: 'USDC',
          decimals: 6,
        },
      } as ChildChainTicketReport

      const result = await formatL2Callvalue(ticket)
      expect(result).toBe('\n\t *Child chain callvalue:* 12.0 USDC')
    })

    it('should handle amounts with default 18 decimals when decimals not specified', async () => {
      const ticket = {
        deposit: {
          amount: ethers.utils.parseEther('12.0').toString(), // 12 with 18 decimals
          symbol: 'XAI',
          // no decimals field
        },
      } as ChildChainTicketReport

      const result = await formatL2Callvalue(ticket)
      expect(result).toBe('\n\t *Child chain callvalue:* 12.0 XAI')
    })

    it('should handle real transaction data from Arbitrum chain', async () => {
      const ticket = {
        deposit: {
          amount: '12000000000000000000', // 12 ETH in wei
          symbol: 'ETH',
          decimals: 18,
        },
      } as ChildChainTicketReport

      const result = await formatL2Callvalue(ticket)
      expect(result).toBe('\n\t *Child chain callvalue:* 12.0 ETH')
    })

    it('should handle real USDC transaction data', async () => {
      const ticket = {
        deposit: {
          amount: '120000000', // 12 USDC with 6 decimals
          symbol: 'USDC',
          decimals: 6,
        },
      } as ChildChainTicketReport

      const result = await formatL2Callvalue(ticket)
      expect(result).toBe('\n\t *Child chain callvalue:* 12.0 USDC')
    })

    it('should handle very small amounts', async () => {
      const ticket = {
        deposit: {
          amount: '1', // 0.000001 USDC
          symbol: 'USDC',
          decimals: 6,
        },
      } as ChildChainTicketReport

      const result = await formatL2Callvalue(ticket)
      expect(result).toBe('\n\t *Child chain callvalue:* 0.000001 USDC')
    })
  })
})
