import type {
  PageObjectResponse,
  QueryDatabaseParameters,
} from '@notionhq/client/build/src/api-endpoints'
import { notionClient, databaseId } from './createNotionClient'
import { isRetryableDecision, type RetryableDecision } from './notionVocabulary'

type TextItem = { plain_text?: string; text?: { content?: string } }
type RetryableProperties = {
  ChainID?: { number?: number | null }
  Status?: { select?: { name?: string } | null }
  Decision?: { select?: { name?: string } | null }
  ParentTx?: { rich_text?: TextItem[] }
  ChildTx?: { title?: TextItem[] }
  CreatedAt?: { date?: { start?: string } | null }
  timeoutTimestamp?: { date?: { start?: string } | null }
  L2CallValue?: { rich_text?: TextItem[] }
  TokensDeposited?: { rich_text?: TextItem[] }
  'Bot Redemption Status'?: { select?: { name?: string } | null }
}

export type NotionRetryableRow = {
  id: string
  chainId?: number
  status: string
  decision: RetryableDecision
  parentTx: string
  retryableUrl: string
  createdAtMs?: number
  timeoutMs?: number
  lastEditedMs?: number
  deposit: string
  botRedemptionStatus?: string
}

const text = (items: TextItem[] | undefined) =>
  items?.[0]?.plain_text ?? items?.[0]?.text?.content

const timestamp = (value: string | undefined) => {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const queryAllPages = async (
  filter?: QueryDatabaseParameters['filter']
): Promise<PageObjectResponse[]> => {
  const pages: PageObjectResponse[] = []
  let cursor: string | undefined

  do {
    const response = await notionClient.databases.query({
      database_id: databaseId,
      page_size: 100,
      start_cursor: cursor,
      ...(filter ? { filter } : {}),
    })
    pages.push(
      ...response.results.filter(
        (page): page is PageObjectResponse => 'properties' in page
      )
    )
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined
  } while (cursor)

  return pages
}

export const getPageTitle = (page: PageObjectResponse, property: string) => {
  const props = page.properties as unknown as Record<
    string,
    { title?: TextItem[] }
  >
  return text(props[property]?.title)
}

export const parseRetryableRow = (
  page: PageObjectResponse
): NotionRetryableRow | null => {
  const props = page.properties as unknown as RetryableProperties
  const decision = props.Decision?.select?.name
  if (!isRetryableDecision(decision)) return null

  const deposit = [
    text(props.L2CallValue?.rich_text),
    text(props.TokensDeposited?.rich_text),
  ]
    .filter(value => value && value !== '0.0 ETH ($0.00)')
    .join(' and ')

  return {
    id: page.id,
    chainId: props.ChainID?.number ?? undefined,
    status: props.Status?.select?.name ?? '(unknown)',
    decision,
    parentTx: text(props.ParentTx?.rich_text) ?? '(unknown)',
    retryableUrl: text(props.ChildTx?.title) ?? '(unknown)',
    createdAtMs: timestamp(props.CreatedAt?.date?.start),
    timeoutMs: timestamp(props.timeoutTimestamp?.date?.start),
    lastEditedMs: timestamp(page.last_edited_time),
    deposit: deposit || '(unknown)',
    botRedemptionStatus: props['Bot Redemption Status']?.select?.name,
  }
}
