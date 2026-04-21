import { OnRetryableFoundParams } from '../core/types'
import { syncRetryableToNotion } from './notion/syncRetryableToNotion'
import {
  isRetryableInNotion,
  hasFetchedNotionRetryables,
} from './notion/fetchedNotionRetryablesUtils'

export const handleRedeemedRetryablesFound = async (
  ticket: OnRetryableFoundParams,
  writeToNotion: boolean
) => {
  if (!writeToNotion) return

  // Only tickets that previously failed are logged in Notion. If we've
  // successfully fetched the existing entries and this ChildTx isn't among
  // them, there's nothing to update — skip the sync entirely. If the fetch
  // failed, fall through to the original query-per-ticket path so state is
  // never silently dropped.
  if (hasFetchedNotionRetryables() && !isRetryableInNotion(ticket.ChildTx)) {
    return
  }

  await syncRetryableToNotion(ticket)
}
