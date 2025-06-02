import { Client } from '@notionhq/client'
import {
  ChildChainTicketReport,
  ParentChainTicketReport,
  TokenDepositData,
} from '../core/types'
import { ChildNetwork } from '../../utils'

const notion = new Client({
  auth: process.env.RETRYABLE_MONITORING_NOTION_TOKEN,
})

const DATABASE_ID = process.env.RETRYABLE_MONITORING_NOTION_DB_ID

interface RetryableTicket {
  id: string
  status: string
  createdAtTimestamp: string
  timeoutTimestamp: string
  transactionHash: string
  childChain: ChildNetwork
  tokenDepositData?: TokenDepositData
}
export const syncRetryableToNotion = async (params: {
  parentChainRetryableReport: ParentChainTicketReport
  childChainRetryableReport: ChildChainTicketReport
  tokenDepositData?: TokenDepositData
  childChain: ChildNetwork
  gasPriceProvided?: string
  gasPriceAtCreation?: string
  gasPriceNow?: string
  totalRetryableDeposit?: string
  priority?: 'High' | 'Medium' | 'Low' | 'Unset'
  tokensDeposited?: string
}) => {
  if (!DATABASE_ID) {
    throw new Error('RETRYABLE_MONITORING_NOTION_DB_ID is not set')
  }

  try {
    const ticket: RetryableTicket = {
      id: params.parentChainRetryableReport.retryableTicketID,
      status: params.childChainRetryableReport.status,
      createdAtTimestamp: params.childChainRetryableReport.createdAtTimestamp,
      timeoutTimestamp: params.childChainRetryableReport.timeoutTimestamp,
      transactionHash: params.parentChainRetryableReport.transactionHash,
      childChain: params.childChain,
      tokenDepositData: params.tokenDepositData,
    }

    console.log('CreatedAt:', ticket.createdAtTimestamp)
    console.log('ExpiresAt:', ticket.timeoutTimestamp)
    const notionPageProps: any = {
      ChildTx: {
        title: [{ text: { content: `Retryable ${ticket.id}` } }],
      },
      Status: {
        select: { name: ticket.status },
      },
      CreatedAt: {
        date: {
          start: new Date(
            Number(ticket.createdAtTimestamp) * 1000
          ).toISOString(),
        },
      },
      timeoutTimestamp: {
        date: {
          start: new Date(Number(ticket.timeoutTimestamp) * 1000).toISOString(),
        },
      },

      GasPriceProvided: {
        rich_text: [{ text: { content: params.gasPriceProvided || 'N/A' } }],
      },
      GasPriceAtCreation: {
        rich_text: [{ text: { content: params.gasPriceAtCreation || 'N/A' } }],
      },
      GasPriceNow: {
        rich_text: [{ text: { content: params.gasPriceNow || 'N/A' } }],
      },
      ParentTx: {
        rich_text: [{ text: { content: ticket.transactionHash } }],
      },
      TotalRetryableDeposit: {
        rich_text: [
          { text: { content: params.totalRetryableDeposit || 'N/A' } },
        ],
      },
      TokensDeposited: {
        rich_text: [{ text: { content: params.tokensDeposited || 'N/A' } }],
      },
      Priority: {
        select: { name: params.priority || 'Unset' },
      },
    }

    const existingPages = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'ParentTx',
        rich_text: { equals: ticket.id },
      },
    })

    if (existingPages.results.length > 0) {
      await notion.pages.update({
        page_id: existingPages.results[0].id,
        properties: notionPageProps,
      })
    } else {
      await notion.pages.create({
        parent: { database_id: DATABASE_ID },
        properties: notionPageProps,
      })
    }
  } catch (error) {
    console.error('Error syncing to Notion:', error)
    throw error
  }
}

export const sweepNotionDatabase = async () => {
  try {
    if (!DATABASE_ID) {
      throw new Error('RETRYABLE_MONITORING_NOTION_DB_ID is not set')
    }

    const now = new Date()

    // Query for retryables that are still unresolved but have expired
    const pages = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          {
            or: [
              {
                property: 'Status',
                select: { equals: 'Untriaged' },
              },
              {
                property: 'Status',
                select: { equals: 'Investigating' },
              },
            ],
          },
          {
            property: 'timeoutTimestamp',
            date: {
              before: now.toISOString(),
            },
          },
        ],
      },
    })

    // Mark each matching ticket as "Expired"
    for (const page of pages.results) {
      await notion.pages.update({
        page_id: page.id,
        properties: {
          Status: {
            select: {
              name: 'Expired',
            },
          },
        },
      })

      const link = `https://www.notion.so/${page.id.replace(/-/g, '')}`
      console.log(`✅ Marked page ${page.id} as Expired`)
    }

    console.log(`Sweep complete. ${pages.results.length} page(s) updated.`)
  } catch (error) {
    console.error('❌ Error sweeping Notion database:', error)
    throw error
  }
}
