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
    status,
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
    const createdAtMs =
      rawCreatedAt > 1e14
        ? Math.floor(rawCreatedAt / 1000)
        : rawCreatedAt > 1e12
        ? rawCreatedAt
        : rawCreatedAt > 1e10
        ? rawCreatedAt
        : rawCreatedAt * 1000

    const notionProps: Record<string, any> = {
      ParentTx: { rich_text: [{ text: { content: ParentTx } }] },
      CreatedAt: { date: { start: new Date(createdAtMs).toISOString() } },
      ChainID: { number: input.chainId },
      Chain: { rich_text: [{ text: { content: input.chain } }] },
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
        rich_text: [{ text: { content: metadata.gasPriceAtCreation ?? 'N/A' } }],
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
      const decisionProp = props?.Decision

      const currentStatus =
        statusProp?.type === 'select' && statusProp.select
          ? statusProp.select.name
          : undefined
      const currentDecision =
        decisionProp?.type === 'select' && decisionProp.select
          ? decisionProp.select.name
          : undefined

      // ✅ Handle Executed updates
      if (status === 'Executed') {
        const executedProps: Record<string, any> = {
          Status: { select: { name: 'Executed' } },
        }

        if (input.timeout) {
          executedProps['timeoutTimestamp'] = {
            date: { start: new Date(input.timeout).toISOString() },
          }
        }

        if (!currentDecision && metadata?.decision) {
          executedProps['Decision'] = {
            select: { name: metadata.decision },
          }
        }

        await notionClient.pages.update({
          page_id: page.id,
          properties: executedProps,
        })

        return { id: page.id, status: 'Executed', isNew: false }
      }

      notionProps['Status'] = { select: { name: status } }

      // Only set Decision if it's missing
      if (!currentDecision && metadata?.decision) {
        notionProps['Decision'] = {
          select: { name: metadata.decision },
        }
      }

      await notionClient.pages.update({
        page_id: page.id,
        properties: notionProps,
      })

      return { id: page.id, status: currentStatus ?? status, isNew: false }
    }

    // If not found and Executed, skip creation
    if (!isRetryableFoundInNotion && status === 'Executed') {
      return undefined
    }

    const created = await notionClient.pages.create({
      parent: { database_id: databaseId },
      properties: {
        ChildTx: { title: [{ text: { content: ChildTx } }] },
        Status: { select: { name: status } },
        ...(metadata?.decision ? { Decision: { select: { name: metadata.decision } } } : {}),
        ...notionProps,
      },
    })

    return { id: created.id, status, isNew: true }
  } catch (err) {
    console.error('❌ Failed to sync ticket to Notion:', err)
    return undefined
  }
}
