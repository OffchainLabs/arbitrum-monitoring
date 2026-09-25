import { getPageTitle, queryAllPages } from './notionRetryableRows'

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

  try {
    const pages = await queryAllPages()
    for (const page of pages) {
      const childTx = getPageTitle(page, 'ChildTx')
      if (childTx) fresh.add(childTx)
    }

    fetchedRetryables.clear()
    for (const v of fresh) fetchedRetryables.add(v)
    hasFetched = true
    console.log(`[notion] fetched ${fetchedRetryables.size} retryable(s)`)
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
