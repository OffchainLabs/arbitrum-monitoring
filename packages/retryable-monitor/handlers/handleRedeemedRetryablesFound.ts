import { OnRetryableFoundParams } from '../core/types'
import { syncRetryableToNotion } from './notion/syncRetryableToNotion'

export const handleRedeemedRetryablesFound = async (
  ticket: OnRetryableFoundParams,
  writeToNotion: boolean
) => {
  if (writeToNotion) {
    await syncRetryableToNotion(ticket)
  }
}
