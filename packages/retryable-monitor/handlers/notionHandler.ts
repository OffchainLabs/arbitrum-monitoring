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

    // Check if ticket already exists in Notion
    const existingPages = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Ticket ID',
        rich_text: {
          equals: ticket.id,
        },
      },
    })

    if (existingPages.results.length > 0) {
      // Update existing page
      await notion.pages.update({
        page_id: existingPages.results[0].id,
        properties: {
          Status: {
            select: {
              name: ticket.status,
            },
          },
          'Last Updated': {
            date: {
              start: new Date().toISOString(),
            },
          },
        },
      })
    } else {
      // Create new page
      await notion.pages.create({
        parent: { database_id: DATABASE_ID },
        properties: {
          'Ticket ID': {
            title: [
              {
                text: {
                  content: ticket.id,
                },
              },
            ],
          },
          Status: {
            select: {
              name: ticket.status,
            },
          },
          'Created At': {
            date: {
              start: new Date(ticket.createdAtTimestamp).toISOString(),
            },
          },
          'Expires At': {
            date: {
              start: new Date(ticket.timeoutTimestamp).toISOString(),
            },
          },
          'Transaction Hash': {
            url: ticket.transactionHash,
          },
          Chain: {
            select: {
              name: ticket.childChain.name,
            },
          },
          'Token Amount': {
            rich_text: [
              {
                text: {
                  content: ticket.tokenDepositData?.tokenAmount || 'N/A',
                },
              },
            ],
          },
          'Token Symbol': {
            rich_text: [
              {
                text: {
                  content: ticket.tokenDepositData?.l1Token.symbol || 'N/A',
                },
              },
            ],
          },
        },
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
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Query for tickets that need updating
    const pages = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          {
            property: 'Status',
            select: {
              in: ['Untriaged', 'Investigating'],
            },
          },
          {
            property: 'Expires At',
            date: {
              before: now.toISOString(),
            },
          },
        ],
      },
    })

    // Update expired tickets
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
    }
  } catch (error) {
    console.error('Error sweeping Notion database:', error)
    throw error
  }
}
