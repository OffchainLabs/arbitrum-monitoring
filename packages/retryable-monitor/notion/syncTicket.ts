import { notion } from './notionClient'
import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'

const databaseId = process.env.RETRYABLE_MONITORING_NOTION_DB_ID!

interface SyncTicketInput {
  ChildTx: string
  ParentTx: string
  createdAt: number
  status?: 'Untriaged' | 'Investigating' | 'Resolved' | 'False Positive' | 'Expired'
  priority?: 'High' | 'Medium' | 'Low' | 'Unset'
  metadata?: {
    tokensDeposited?: string
    gasPriceProvided: string
    gasPriceAtCreation?: string
    gasPriceNow: string
    l2CallValue: string
  }
}

export async function syncTicketToNotion(
  input: SyncTicketInput
): Promise<{ id: string; status: string } | undefined> {
  const {
    ChildTx,
    ParentTx,
    createdAt,
    status = 'Untriaged',
    priority = 'Unset',
    metadata,
  } = input

  try {
    const search = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: 'ChildTx',
        rich_text: {
          equals: ChildTx,
        },
      },
    })

    const notionProps: Record<string, any> = {
      ParentTx: { rich_text: [{ text: { content: ParentTx } }] },
      CreatedAt: { date: { start: new Date(createdAt).toISOString() } },
      Priority: { select: { name: priority } },
    }

    if (metadata) {
      notionProps['GasPriceProvided'] = {
        rich_text: [{ text: { content: metadata.gasPriceProvided } }],
      }
      notionProps['GasPriceAtCreation'] = {
        rich_text: [{ text: { content: metadata.gasPriceAtCreation ?? 'N/A' } }],
      }
      notionProps['GasPriceNow'] = {
        rich_text: [{ text: { content: metadata.gasPriceNow } }],
      }
      notionProps['L2CallValue'] = {
        rich_text: [{ text: { content: metadata.l2CallValue } }],
      }
      if (metadata.tokensDeposited) {
        notionProps['TokensDeposited'] = {
          rich_text: [{ text: { content: metadata.tokensDeposited } }],
        }
      }
    }

    if (search.results.length > 0) {
      const page = search.results[0]

      if (!('properties' in page)) {
        console.error('⚠️ Skipping update: Notion page missing properties.')
        return
      }

      const props = (page as PageObjectResponse).properties
      const statusProp = props?.Status

      let currentStatus: string | undefined = undefined
      if (statusProp && statusProp.type === 'select' && statusProp.select) {
        currentStatus = statusProp.select.name
      }

      // Only overwrite status if still Untriaged or missing
      if (currentStatus === 'Untriaged' || !currentStatus) {
        notionProps['Status'] = { select: { name: status } }
      }

      await notion.pages.update({
        page_id: page.id,
        properties: notionProps,
      })

      return { id: page.id, status: currentStatus ?? status }
    }

    // Entry doesn't exist — create it
    const created = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        ChildTx: { title: [{ text: { content: ChildTx } }] },
        Status: { select: { name: status } },
        ...notionProps,
      },
    })

    return { id: created.id, status }
  } catch (err) {
    console.error('❌ Failed to sync ticket to Notion:', err)
    return undefined
  }
}
