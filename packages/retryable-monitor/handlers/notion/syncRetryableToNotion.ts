import { notionClient } from './createNotionClient'
import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'
import { postSlackMessage } from '../slack/postSlackMessage'
import { OnRetryableFoundParams } from '../../core/types'
import { ethers, BigNumber } from 'ethers'
import { getTokenPrice } from '../slack/slackMessageFormattingUtils'
import { parseAmount } from 'utils'

const databaseId = process.env.RETRYABLE_MONITORING_NOTION_DB_ID!
const NOTION_RICH_TEXT_MAX = 2000
function truncateForNotion(
  s: string,
  max = NOTION_RICH_TEXT_MAX,
  suffix = '...[truncated]'
) {
  if (!s) return s
  const hard = max - suffix.length
  return s.length > hard ? s.slice(0, hard) + suffix : s
}

async function buildTokensDepositedDisplay(metadata: any): Promise<string> {
  if (
    !metadata?.tokenAmountRaw ||
    metadata?.tokenDecimals === undefined ||
    !metadata?.l1TokenAddress ||
    !metadata?.tokenSymbol
  ) {
    return metadata?.tokensDeposited ?? '-'
  }

  const amountStr = ethers.utils.formatUnits(
    metadata.tokenAmountRaw,
    metadata.tokenDecimals
  )

  const price = await getTokenPrice(
    String(metadata.l1TokenAddress).toLowerCase()
  )

  if (price !== undefined) {
    const amountBN = parseAmount(amountStr, metadata.tokenDecimals)
    const usdValue =
      amountBN
        .mul(Math.floor(price * 1e6))
        .div(BigNumber.from(10).pow(metadata.tokenDecimals))
        .toNumber() / 1e6

    return `${amountStr} ${metadata.tokenSymbol} ($${usdValue.toFixed(2)}) (${
      metadata.l1TokenAddress
    })`
  }

  return `${amountStr} ${metadata.tokenSymbol} (${metadata.l1TokenAddress})`
}

export async function syncRetryableToNotion(
  input: OnRetryableFoundParams
): Promise<{ id: string; status: string; isNew: boolean } | undefined> {
  const { ChildTx, ParentTx, ParentTxUrl, createdAt, status, metadata } = input

  try {
    const search = await notionClient.databases.query({
      database_id: databaseId,
      filter: {
        property: 'ChildTx',
        rich_text: {
          equals: ChildTx,
        },
      },
    })

    const isRetryableFoundInNotion = search.results.length > 0

    const rawCreatedAt = createdAt
    const createdAtMs =
      rawCreatedAt > 1e14
        ? Math.floor(rawCreatedAt / 1000)
        : rawCreatedAt > 1e12
        ? rawCreatedAt
        : rawCreatedAt > 1e10
        ? rawCreatedAt
        : rawCreatedAt * 1000

    const notionProps: Record<string, any> = {
      ParentTx: { rich_text: [{ text: { content: ParentTxUrl } }] },
      RetryableDashboard: {
        url: `https://retryable-dashboard.arbitrum.io/tx/${ParentTx}`,
      },
      CreatedAt: { date: { start: new Date(createdAtMs).toISOString() } },
      ChainID: { number: input.chainId },
      Chain: { rich_text: [{ text: { content: input.chain } }] },
    }

    if (input.timeout) {
      notionProps['timeoutTimestamp'] = {
        date: { start: new Date(input.timeout).toISOString() },
      }
    }

    if (metadata) {
      notionProps['GasPriceProvided'] = {
        rich_text: [{ text: { content: metadata.gasPriceProvided } }],
      }
      notionProps['GasPriceAtCreation'] = {
        rich_text: [
          { text: { content: metadata.gasPriceAtCreation ?? 'N/A' } },
        ],
      }
      notionProps['GasPriceNow'] = {
        rich_text: [{ text: { content: metadata.gasPriceNow } }],
      }

      if (metadata.l2CallValue) {
        notionProps['L2CallValue'] = {
          rich_text: [{ text: { content: metadata.l2CallValue } }],
        }
      }

      if (metadata.feeRefundAddress) {
        notionProps['FeeRefundAddress'] = {
          rich_text: [{ text: { content: metadata.feeRefundAddress } }],
        }
      }
      if (metadata.beneficiary) {
        notionProps['Beneficiary'] = {
          rich_text: [{ text: { content: metadata.beneficiary } }],
        }
      }
      if (metadata.retryTo) {
        notionProps['RetryTo'] = {
          rich_text: [{ text: { content: metadata.retryTo } }],
        }
      }
      if (metadata.retryData) {
        notionProps['RetryData'] = {
          rich_text: [
            { text: { content: truncateForNotion(metadata.retryData, 1950) } },
          ],
        }
      }

      const tokensDepositedDisplay = await buildTokensDepositedDisplay(metadata)
      notionProps['TokensDeposited'] = {
        rich_text: [{ text: { content: tokensDepositedDisplay } }],
      }

      // support verbose column for bot redemption outcome if provided
      if (metadata.botRedemptionStatus) {
        notionProps['Bot Redemption Status'] = {
          select: { name: metadata.botRedemptionStatus },
        }
      }
    }

    if (isRetryableFoundInNotion) {
      const page = search.results[0]

      if (!('properties' in page)) {
        const errorMessage = `⚠️ Notion sync failed: page for ${ChildTx} is missing 'properties'. Skipping update.`
        console.error(errorMessage)
        await postSlackMessage({ message: errorMessage })
        return
      }

      const props = (page as PageObjectResponse).properties
      const statusProp = props?.Status
      const decisionProp = props?.Decision

      const currentStatus =
        statusProp?.type === 'select' && statusProp.select
          ? statusProp.select.name
          : undefined
      const currentDecision =
        decisionProp?.type === 'select' && decisionProp.select
          ? decisionProp.select.name
          : undefined

      // ✅ Handle Executed updates
      if (status === 'Executed') {
        const executedProps: Record<string, any> = {
          Status: { select: { name: 'Executed' } },
        }

        if (input.timeout) {
          executedProps['timeoutTimestamp'] = {
            date: { start: new Date(input.timeout).toISOString() },
          }
        }

        if (!currentDecision && input.decision) {
          executedProps['Decision'] = {
            select: { name: input.decision },
          }
        }

        // carry Bot Redemption Status if present on this update
        if (metadata?.botRedemptionStatus) {
          executedProps['Bot Redemption Status'] = {
            select: { name: metadata.botRedemptionStatus },
          }
        }

        await notionClient.pages.update({
          page_id: page.id,
          properties: executedProps,
        })

        return { id: page.id, status: 'Executed', isNew: false }
      }

      notionProps['Status'] = { select: { name: status } }

      // Only set Decision if it's missing
      if (!currentDecision && input.decision) {
        notionProps['Decision'] = {
          select: { name: input.decision },
        }
      }

      await notionClient.pages.update({
        page_id: page.id,
        properties: notionProps,
      })

      return { id: page.id, status: currentStatus ?? status, isNew: false }
    }

    // If not found and Executed, skip creation
    if (!isRetryableFoundInNotion && status === 'Executed') {
      return undefined
    }

    const created = await notionClient.pages.create({
      parent: { database_id: databaseId },
      properties: {
        ChildTx: { title: [{ text: { content: ChildTx } }] },
        Status: { select: { name: status } },
        ...(input.decision
          ? { Decision: { select: { name: input.decision } } }
          : {}),
        ...(metadata?.botRedemptionStatus
          ? {
              'Bot Redemption Status': {
                select: { name: metadata.botRedemptionStatus },
              },
            }
          : {}),
        ...notionProps,
      },
    })

    return { id: created.id, status, isNew: true }
  } catch (err) {
    console.error('❌ Failed to sync ticket to Notion:', err)
    return undefined
  }
}
