import { notionClient } from './createNotionClient'
import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'
import { postSlackMessage } from '../slack/postSlackMessage'
import { OnRetryableFoundParams } from '../../core/types'

const databaseId = process.env.RETRYABLE_MONITORING_NOTION_DB_ID!

export async function syncRetryableToNotion(
  input: OnRetryableFoundParams
): Promise<{ id: string; status: string; isNew: boolean } | undefined> {
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

    const rawCreatedAt = metadata?.createdAt ?? createdAt

    // Normalize to milliseconds (ms) — only if needed
    let createdAtMs: number

    if (rawCreatedAt > 1e14) {
      // Too big: microseconds → convert to ms
      createdAtMs = Math.floor(rawCreatedAt / 1000)
    } else if (rawCreatedAt > 1e12) {
      // Still too big: milliseconds → use as-is
      createdAtMs = rawCreatedAt
    } else if (rawCreatedAt > 1e10) {

      createdAtMs = rawCreatedAt
    } else {
      // Normal seconds → convert to ms
      createdAtMs = rawCreatedAt * 1000
    }
    const notionProps: Record<string, any> = {
      ParentTx: { rich_text: [{ text: { content: ParentTx } }] },
      CreatedAt: {
        date: {
          start: new Date(createdAtMs).toISOString(),
        },
      },
      Priority: { select: { name: priority } },
    }
    if (input.timeout) {
      notionProps['timeoutTimestamp'] = {
        date: { start: new Date(input.timeout).toISOString() },
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

      if (status === 'Resolved') {
        const resolvedProps: Record<string, any> = {
          Status: { select: { name: 'Resolved' } },
        }

        if (input.timeout) {
          resolvedProps['timeoutTimestamp'] = {
            date: { start: new Date(input.timeout).toISOString() },
          }
        }

        return await notionClient.pages
          .update({
            page_id: page.id,
            properties: resolvedProps,
          })
          .then(() => ({
            id: page.id,
            status: 'Resolved',
            isNew: false,
          }))
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

    if (!isRetryableFoundInNotion && status === 'Resolved') {
      // Resolved but not found—skip
      return undefined
    }

    // Retryable is new and unresolved—create full entry
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
