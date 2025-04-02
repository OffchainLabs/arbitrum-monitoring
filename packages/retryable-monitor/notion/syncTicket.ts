import { notion } from './notionClient'

const databaseId = process.env.RETRYABLE_MONITORING_NOTION_DB_ID!

export async function syncTicketToNotion({
  ticketId,
  l1TxHash,
  target,
  createdAt,
}: {
  ticketId: string
  l1TxHash: string
  target: string
  createdAt: number
}) {
  if (!process.env.RETRYABLE_MONITORING_ENABLE_TRIAGE) return

  try {
    const search = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: 'Ticket ID',
        rich_text: {
          equals: ticketId,
        },
      },
    })

    if (search.results.length > 0) {
      const pageId = search.results[0].id
      await notion.pages.update({
        page_id: pageId,
        properties: {
          L1TxHash: { rich_text: [{ text: { content: l1TxHash } }] },
          Target: { rich_text: [{ text: { content: target } }] },
          CreatedAt: { date: { start: new Date(createdAt).toISOString() } },
        },
      })
    } else {
      await notion.pages.create({
        parent: { database_id: databaseId },
        properties: {
          'Ticket ID': { title: [{ text: { content: ticketId } }] },
          L1TxHash: { rich_text: [{ text: { content: l1TxHash } }] },
          Target: { rich_text: [{ text: { content: target } }] },
          CreatedAt: { date: { start: new Date(createdAt).toISOString() } },
          Status: { select: { name: 'Untriaged' } },
        },
      })
    }
  } catch (err) {
    console.error('❌ Failed to sync ticket to Notion:', err)
  }
}
