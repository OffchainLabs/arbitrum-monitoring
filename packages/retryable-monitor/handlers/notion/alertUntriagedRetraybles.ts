import { notionClient, databaseId } from './createNotionClient'
import { postSlackMessage } from '../slack/postSlackMessage'

export const alertUntriagedNotionRetryables = async () => {
  const response = await notionClient.databases.query({
    database_id: databaseId,
    page_size: 100,
    filter: {
      and: [
        {
          or: [
            { property: 'Decision', select: { equals: 'Triage' } },
            { property: 'Decision', select: { equals: 'Should Redeem' } },
          ],
        },
        {
          property: 'Status',
          select: { does_not_equal: 'Executed' },
        },
      ],
    },
  })

  for (const page of response.results) {
    const props = (page as any).properties
    const timeoutStr = props?.timeoutTimestamp?.date?.start
    const retryableUrl =
      props?.ChildTx?.title?.[0]?.text?.content || '(unknown)'
    const decision = props?.Decision?.select?.name || '(unknown)'

    await postSlackMessage({
      message: `⚠️ Retryable ticket still pending:\n• Retryable: ${retryableUrl}\n• Decision: ${decision}\n• Timeout: ${timeoutStr}`,
    })
  }
}
