import type { QueryDatabaseResponse } from '@notionhq/client/build/src/api-endpoints'
import { notionClient, databaseId } from './createNotionClient'

// In-memory record of `ChildTx` values (full explorer URLs) that currently
// exist in the Notion database. Populated once at startup by
// `fetchNotionRetryables` and kept coherent within a run via
// `addToFetchedNotionRetryables`. ChildTx URLs embed the explorer prefix so
// they're globally unique across chains — a flat Set is sufficient.
const fetchedRetryables = new Set<string>()
let hasFetched = false

export const hasFetchedNotionRetryables = () => hasFetched

export const isRetryableInNotion = (childTx: string) =>
  fetchedRetryables.has(childTx)

export const addToFetchedNotionRetryables = (childTx: string) => {
  fetchedRetryables.add(childTx)
}

export const fetchNotionRetryables = async () => {
  const fresh = new Set<string>()
  let cursor: string | undefined = undefined
  let pageCount = 0

  try {
    do {
      const res: QueryDatabaseResponse = await notionClient.databases.query({
        database_id: databaseId,
        page_size: 100,
        start_cursor: cursor,
      })

      for (const page of res.results) {
        const titleProp = (page as any).properties?.ChildTx
        const childTx =
          titleProp?.title?.[0]?.plain_text ??
          titleProp?.title?.[0]?.text?.content
        if (typeof childTx === 'string' && childTx.length > 0) {
          fresh.add(childTx)
        }
      }

      cursor = res.has_more ? res.next_cursor ?? undefined : undefined
      pageCount++
    } while (cursor)

    fetchedRetryables.clear()
    for (const v of fresh) fetchedRetryables.add(v)
    hasFetched = true
    console.log(
      `[notion] fetched ${fetchedRetryables.size} existing retryable(s) across ${pageCount} query page(s)`
    )
  } catch (err) {
    // Safe degradation: leave `hasFetched` false so the gatekeeper falls
    // through to the original query-per-ticket path instead of silently
    // dropping writes.
    hasFetched = false
    console.warn(
      '[notion] failed to fetch existing retryables; falling back to query-per-ticket behavior:',
      err
    )
  }
}
