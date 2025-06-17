import { notionClient, databaseId } from './createNotionClient'
import { postSlackMessage } from '../slack/postSlackMessage'

const formatDate = (iso: string | undefined) => {
  if (!iso) return '(unknown)'
  const date = new Date(iso)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date) // e.g. "Jun 6, 2025, 04:51 UTC"
}

const isNearExpiry = (iso: string | undefined, hours = 24) => {
  if (!iso) return false
  const expiry = new Date(iso).getTime()
  const now = Date.now()
  const timeLeftMs = expiry - now
  return timeLeftMs <= hours * 60 * 60 * 1000
}

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
  const timeoutRaw = props?.timeoutTimestamp?.date?.start
  const timeoutStr = formatDate(timeoutRaw)
  const retryableUrl =
    props?.ChildTx?.title?.[0]?.text?.content || '(unknown)'
  const decision = props?.Decision?.select?.name || '(unknown)'

  let message = ''

  if (decision === 'Triage') {
    message = `⚠️ Retryable ticket needs triage:\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n→ Please review and decide whether to redeem or ignore.`
  } else if (decision === 'Should Redeem') {
    if (!isNearExpiry(timeoutRaw)) continue // Skip if not near expiry
    message = `🚨 Retryable marked for redemption and nearing expiry:\n• Retryable: ${retryableUrl}\n• Timeout: ${timeoutStr}\n→ Check why it hasn't been executed.`
  } else {
    continue // skip unexpected decisions
  }

  await postSlackMessage({ message })
}

}
