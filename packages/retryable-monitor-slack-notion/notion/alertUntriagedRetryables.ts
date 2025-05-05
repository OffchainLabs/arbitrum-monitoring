import { notion, databaseId } from './notionClient'
import { reportRetryableErrorToSlack } from '../reportRetryableErrorToSlack'

export const alertUntriagedNotionRetryables = async () => {
  const response = await notion.databases.query({
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
    const retryableUrl = props?.ChildTx?.title?.[0]?.text?.content || '(unknown)'

    await reportRetryableErrorToSlack({
      message: `⚠️ Retryable ticket still untriaged:\n• Retryable: ${retryableUrl}\n• Status: Untriaged\n• Timeout: ${timeoutStr}`,
    })
  }
}
