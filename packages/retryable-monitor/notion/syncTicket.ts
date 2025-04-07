import { notion } from './notionClient';

const databaseId = process.env.RETRYABLE_MONITORING_NOTION_DB_ID!;

interface SyncTicketInput {
    ChildTx: string
    ParentTx: string
    createdAt: number
    timeout?: number
    status?: 'Untriaged' | 'Investigating' | 'Resolved' | 'False Positive' | 'Expired'
    priority?: 'High' | 'Medium' | 'Low' | 'Unset'
    metadata?: {
        tokensDeposited?: string
        gasPriceProvided: string
        gasPriceAtCreation?: string
        gasPriceNow: string
        l2CallValue: string
      }
  }
  
  export async function syncTicketToNotion(input: SyncTicketInput): Promise<{ id: string; status: string } | undefined> {
    if (!process.env.RETRYABLE_MONITORING_ENABLE_TRIAGE) return;
  
    const {
        ChildTx,
        ParentTx,
      createdAt,
      timeout,
      status = 'Untriaged',
      priority = 'Unset',
      metadata,
    } = input;
  
    try {
      const search = await notion.databases.query({
        database_id: databaseId,
        filter: {
          property: 'ChildTx',
          rich_text: {
            equals: ChildTx,
          },
        },
      });
  
      const notionProps: Record<string, any> = {
        'ParentTx': { rich_text: [{ text: { content: ParentTx } }] },
        'CreatedAt': { date: { start: new Date(createdAt).toISOString() } },
        'Status': { select: { name: status } },
        'Priority': { select: { name: priority } },
      };
      if (timeout) {
        notionProps['timeout'] = {
          date: { start: new Date(timeout).toISOString() },
        };
      }
  
      if (metadata) {
        notionProps['GasPriceProvided'] = {
            rich_text: [{ text: { content: metadata.gasPriceProvided } }],
          }
          notionProps['GasPriceAtCreation'] = {
            rich_text: [{ text: { content: metadata.gasPriceAtCreation ?? 'N/A' } }],
          }
          notionProps['GasPriceNow'] = {
            rich_text: [{ text: { content: metadata.gasPriceNow } }],
          }
          
        if (metadata.tokensDeposited) {
          notionProps['TokensDeposited'] = {
            rich_text: [{ text: { content: metadata.tokensDeposited } }],
          };
        }
        notionProps['L2CallValue'] = {
            rich_text: [{ text: { content: metadata.l2CallValue } }],
          }
          
      }
  
      
      if (search.results.length > 0) {
        const pageId = search.results[0].id;
        await notion.pages.update({
          page_id: pageId,
          properties: notionProps,
        });
        return { id: pageId, status };
      } else {
        const created = await notion.pages.create({
          parent: { database_id: databaseId },
          properties: {
            'ChildTx': { title: [{ text: { content: ChildTx } }] },
            ...notionProps,
          },
        });
        return { id: created.id, status };
      }
    } catch (err) {
      console.error('❌ Failed to sync ticket to Notion:', err);
      return undefined;
    }
  }
