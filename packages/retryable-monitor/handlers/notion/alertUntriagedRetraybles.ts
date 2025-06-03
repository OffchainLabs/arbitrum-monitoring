import { notionClient, databaseId } from './createNotionClient'
import { postSlackMessage } from '../slack/postSlackMessage'

/**
 * Queries the Notion database for untriaged retryable tickets and sends Slack alerts for each one.
 * This helps ensure that failed retryables don't go unnoticed and get proper investigation.
 */

export const alertUntriagedNotionRetryables = async () => {
  const response = await notionClient.databases.query({
    database_id: databaseId,
    page_size: 100,
    filter: {
      property: 'Status',
      select: { equals: 'Untriaged' },
    },
  })

  for (const page of response.results) {
    const props = (page as any).properties
    const timeoutStr = props?.timeoutTimestamp?.date?.start
    const retryableUrl =
      props?.ChildTx?.title?.[0]?.text?.content || '(unknown)'

    await postSlackMessage({
      message: `⚠️ Retryable ticket still untriaged:\n• Retryable: ${retryableUrl}\n• Status: Untriaged\n• Timeout: ${timeoutStr}`,
    })
  }
}
