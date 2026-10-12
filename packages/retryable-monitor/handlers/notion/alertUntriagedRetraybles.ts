import { ParentToChildMessageStatus } from '@arbitrum/sdk'
import type {
  PageObjectResponse,
  QueryDatabaseParameters,
  UpdatePageParameters,
} from '@notionhq/client/build/src/api-endpoints'
import { DEFAULT_CONFIG_PATH, type ChildNetwork } from 'utils'
import {
  getLiveRetryableStatus,
  locateRetryable,
  redeemRetryable,
  type LocatedRetryable,
} from '../../core/redeemRetryable'
import {
  REDEEM_FAILURE_REASON,
  type RedeemFailureReason,
} from '../../core/types'
import { formatActionRunReference } from '../slack/slackMessageFormattingUtils'
import { postSlackMessage } from '../slack/postSlackMessage'
import { notionClient } from './createNotionClient'
import {
  parseRetryableRow,
  queryAllPages,
  type NotionRetryableRow,
} from './notionRetryableRows'
import {
  NOTION_DECISION,
  NOTION_STATUS,
  retryableStatusToNotion,
} from './notionVocabulary'
import {
  AUTO_REDEEM_DELAY_MS,
  decideRetryableAction,
} from './retryableSweepPolicy'

export const TRIAGE_DECISION = NOTION_DECISION.TRIAGE
export const SHOULD_REDEEM_DECISION = NOTION_DECISION.SHOULD_REDEEM
export const FORCE_REDEEM_DECISION = NOTION_DECISION.FORCE_REDEEM
export const AUTO_REDEEM_DELAY_DAYS = AUTO_REDEEM_DELAY_MS / 86_400_000

type AssessedRow = {
  row: NotionRetryableRow
  located: LocatedRetryable | null
  liveStatus: ParentToChildMessageStatus | null
}

type Filter = NonNullable<QueryDatabaseParameters['filter']>
type UpdateProperties = NonNullable<UpdatePageParameters['properties']>
type UpdatePage = (
  pageId: string,
  properties: UpdateProperties
) => Promise<void>

export const extractTxHash = (value: string | undefined) =>
  value?.match(/0x[a-fA-F0-9]{64}/)?.[0] ?? null

const buildFilters = (childChains: ChildNetwork[]): Filter[] => {
  const chainScope = childChains.map(({ chainId }) => ({
    property: 'ChainID',
    number: { equals: chainId },
  }))
  const scoped = (conditions: Filter[]) =>
    ({
      and:
        chainScope.length > 0
          ? [{ or: chainScope }, ...conditions]
          : conditions,
    } as Filter)

  return [
    scoped([
      {
        or: [
          {
            property: 'Decision',
            select: { equals: NOTION_DECISION.SHOULD_REDEEM },
          },
          {
            property: 'Decision',
            select: { equals: NOTION_DECISION.FORCE_REDEEM },
          },
        ],
      },
    ]),
    scoped([
      {
        property: 'Decision',
        select: { equals: NOTION_DECISION.TRIAGE },
      },
      {
        property: 'Status',
        select: { does_not_equal: NOTION_STATUS.EXECUTED },
      },
    ]),
  ]
}

const readLiveStatus = async (
  row: NotionRetryableRow,
  configPath: string
): Promise<AssessedRow> => {
  const parentTxHash = extractTxHash(row.parentTx)
  const retryableCreationId = extractTxHash(row.retryableUrl)
  if (!parentTxHash || !retryableCreationId) {
    console.error(`[notion] could not read tx hashes for ${row.id}`)
    return { row, located: null, liveStatus: null }
  }

  try {
    const located = await locateRetryable(parentTxHash, {
      configPath,
      retryableCreationId,
      chainId: row.chainId,
    })
    const liveStatus = located ? await getLiveRetryableStatus(located) : null
    return { row, located, liveStatus }
  } catch (error) {
    console.error(
      `[notion] could not read live status for ${row.retryableUrl}:`,
      error
    )
    return { row, located: null, liveStatus: null }
  }
}

const getDrift = ({ row, liveStatus }: AssessedRow): UpdateProperties => {
  if (liveStatus === null) return {}
  const status = retryableStatusToNotion(liveStatus)
  const decision =
    status === NOTION_STATUS.EXECUTED ? NOTION_DECISION.REDEEMED : row.decision

  return {
    ...(status !== row.status && { Status: { select: { name: status } } }),
    ...(decision !== row.decision && {
      Decision: { select: { name: decision } },
    }),
  }
}

const postMessage = async (message: string) => {
  try {
    await postSlackMessage({ message })
  } catch {
    return
  }
}

const formatSummary = (heading: string, urls: string[]) =>
  `${heading}${formatActionRunReference()}:` +
  urls
    .slice(0, 10)
    .map(url => `\n• ${url}`)
    .join('') +
  (urls.length > 10 ? `\n• … and ${urls.length - 10} more` : '')

const createPageUpdater =
  (writeFailures: string[]): UpdatePage =>
  async (pageId, properties) => {
    try {
      await notionClient.pages.update({ page_id: pageId, properties })
    } catch (error) {
      console.error(`[notion] could not update ${pageId}:`, error)
      writeFailures.push(pageId)
    }
  }

const assessRows = async (
  rows: NotionRetryableRow[],
  configPath: string,
  updatePage: UpdatePage
) => {
  const assessed: AssessedRow[] = []
  for (const row of rows) {
    const result = await readLiveStatus(row, configPath)
    assessed.push(result)
    const drift = getDrift(result)
    if (Object.keys(drift).length > 0) await updatePage(row.id, drift)
  }
  return assessed
}

type FailedRedemption = {
  url: string
  reason: RedeemFailureReason
  detail: string
}

const NOTION_TEXT_LIMIT = 2000
const SLACK_DETAIL_LIMIT = 200

// read by shape: the redeem module is mocked wholesale in tests
const readFailure = (error: unknown) => {
  const { failureReason, detail } = (error ?? {}) as {
    failureReason?: RedeemFailureReason
    detail?: string
  }
  return {
    reason: failureReason ?? REDEEM_FAILURE_REASON.BOT_ERROR,
    detail: detail ?? (error instanceof Error ? error.message : String(error)),
  }
}

const executeActions = async (
  assessed: AssessedRow[],
  autoRedeem: boolean,
  updatePage: UpdatePage
) => {
  const redeemed: string[] = []
  const failed: FailedRedemption[] = []
  for (const { row, located, liveStatus } of assessed) {
    const action = decideRetryableAction(row, liveStatus, autoRedeem)
    if (action.type === 'skip') continue
    if (action.type === 'alert') {
      await postMessage(action.message)
      continue
    }
    if (!located) continue

    const attemptedAt = {
      'Bot Last Attempt': { date: { start: new Date().toISOString() } },
    }
    try {
      await redeemRetryable(located)
      redeemed.push(row.retryableUrl)
      await updatePage(row.id, {
        Status: { select: { name: NOTION_STATUS.EXECUTED } },
        Decision: { select: { name: NOTION_DECISION.REDEEMED } },
        'Bot Redemption Status': { select: { name: 'Bot Success' } },
        ...attemptedAt,
        'Bot Failure Reason': { select: null },
        'Bot Failure Detail': { rich_text: [] },
      })
    } catch (error) {
      console.error(`[notion] auto-redeem failed for ${row.parentTx}:`, error)
      const { reason, detail } = readFailure(error)
      failed.push({ url: row.retryableUrl, reason, detail })
      await updatePage(row.id, {
        'Bot Redemption Status': { select: { name: 'Bot Failed' } },
        ...attemptedAt,
        'Bot Failure Reason': { select: { name: reason } },
        'Bot Failure Detail': {
          rich_text: [
            { text: { content: detail.slice(0, NOTION_TEXT_LIMIT) } },
          ],
        },
      })
    }
  }
  return { redeemed, failed }
}

const describeFailures = (failed: FailedRedemption[]) => {
  const counts = new Map<RedeemFailureReason, number>()
  for (const { reason } of failed) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return [...counts].map(([reason, count]) => `${reason}: ${count}`).join(', ')
}

const postRunSummaries = async (
  redeemed: string[],
  failed: FailedRedemption[]
) => {
  if (redeemed.length > 0) {
    await postMessage(
      formatSummary(
        `✅ ${redeemed.length} retryable${
          redeemed.length === 1 ? '' : 's'
        } auto-redeemed`,
        redeemed
      )
    )
  }
  if (failed.length > 0) {
    await postMessage(
      formatSummary(
        `🚨 ${failed.length} retryable auto-redemption${
          failed.length === 1 ? '' : 's'
        } failed (${describeFailures(
          failed
        )}); the bot will retry after 24 hours`,
        failed.map(
          ({ url, reason, detail }) =>
            `${url} (${reason}: ${detail.slice(0, SLACK_DETAIL_LIMIT)})`
        )
      )
    )
  }
}

export const alertUntriagedNotionRetryables = async (
  childChains: ChildNetwork[] = [],
  autoRedeem = false,
  configPath: string = DEFAULT_CONFIG_PATH
) => {
  const pages: PageObjectResponse[] = []
  for (const filter of buildFilters(childChains)) {
    pages.push(...(await queryAllPages(filter)))
  }
  const rows = pages
    .map(parseRetryableRow)
    .filter((row): row is NotionRetryableRow => row !== null)
  const writeFailures: string[] = []
  const updatePage = createPageUpdater(writeFailures)
  const assessed = await assessRows(rows, configPath, updatePage)
  const { redeemed, failed } = await executeActions(
    assessed,
    autoRedeem,
    updatePage
  )
  await postRunSummaries(redeemed, failed)
  if (writeFailures.length > 0) {
    console.error(
      `[notion] ${
        writeFailures.length
      } row(s) could not be updated this run: ${writeFailures.join(', ')}`
    )
  }
}
