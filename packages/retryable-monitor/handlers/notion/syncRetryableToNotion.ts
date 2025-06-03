import { notionClient } from './createNotionClient'
import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'
import { postSlackMessage } from '../slack/postSlackMessage'
import { OnRetryableFoundParams } from '../../core/types'

const databaseId = process.env.RETRYABLE_MONITORING_NOTION_DB_ID!

/**
 * Syncs a retryable ticket to the Notion database.
 *
 * If the ticket already exists, updates the status and other properties.
 * If the ticket doesn't exist, creates a new entry.
 *
 * @param input - The Retryable ticket data to sync to Notion
 * @returns The ID of the synced ticket and its new status
 */

export async function syncRetryableToNotion(
  input: OnRetryableFoundParams
): Promise<{ id: string; status: string; isNew: boolean } | undefined> {
  console.log('xxxxx', input, input.status)

  const {
    ChildTx,
    ParentTx,
    createdAt,
    status = 'Untriaged',
    priority = 'Unset',
    metadata,
  } = input

  try {
    const search = await notionClient.databases.query({
      database_id: databaseId,
      filter: {
        property: 'ChildTx',
        rich_text: {
          equals: ChildTx,
        },
      },
    })

    const isRetryableFoundInNotion = search.results.length > 0

    const notionProps: Record<string, any> = {
      ParentTx: { rich_text: [{ text: { content: ParentTx } }] },
      CreatedAt: { date: { start: new Date(createdAt).toISOString() } },
      Priority: { select: { name: priority } },
    }
    if (input.timeout) {
      notionProps['timeoutTimestamp'] = {
        date: { start: new Date(input.timeout * 1000).toISOString() },
      }
    }
    if (metadata) {
      notionProps['GasPriceProvided'] = {
        rich_text: [{ text: { content: metadata.gasPriceProvided } }],
      }
      notionProps['GasPriceAtCreation'] = {
        rich_text: [
          { text: { content: metadata.gasPriceAtCreation ?? 'N/A' } },
        ],
      }
      notionProps['GasPriceNow'] = {
        rich_text: [{ text: { content: metadata.gasPriceNow } }],
      }
      notionProps['TotalRetryableDeposit'] = {
        rich_text: [{ text: { content: metadata.l2CallValue } }],
      }
      if (metadata.tokensDeposited) {
        notionProps['TokensDeposited'] = {
          rich_text: [{ text: { content: metadata.tokensDeposited } }],
        }
      }
    }

    if (isRetryableFoundInNotion) {
      const page = search.results[0]

      if (!('properties' in page)) {
        const errorMessage = `⚠️ Notion sync failed: page for ${ChildTx} is missing 'properties'. Skipping update.`
        console.error(errorMessage)
        await postSlackMessage({ message: errorMessage })
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

      await notionClient.pages.update({
        page_id: page.id,
        properties: notionProps,
      })

      return { id: page.id, status: currentStatus ?? status, isNew: false }
    }

    if (isRetryableFoundInNotion && status === 'Resolved') {
      // if the retryable is resolved, we don't need to do anything
      return undefined
    }

    // For Unresolved retryables, we need to create a new entry in the Notion database
    const created = await notionClient.pages.create({
      parent: { database_id: databaseId },
      properties: {
        ChildTx: { title: [{ text: { content: ChildTx } }] },
        Status: { select: { name: status } },
        ...notionProps,
      },
    })

    return { id: created.id, status, isNew: true }
  } catch (err) {
    console.error('❌ Failed to sync ticket to Notion:', err)
    return undefined
  }
}
