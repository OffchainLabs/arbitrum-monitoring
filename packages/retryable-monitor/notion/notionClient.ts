import { Client } from '@notionhq/client';

export const notion = new Client({
  auth: process.env.RETRYABLE_MONITORING_NOTION_TOKEN,
});
