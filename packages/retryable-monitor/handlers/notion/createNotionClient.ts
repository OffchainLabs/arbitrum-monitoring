import { Client } from '@notionhq/client'
import dotenv from 'dotenv'

dotenv.config()

export const notionClient = new Client({
  auth: process.env.RETRYABLE_MONITORING_NOTION_TOKEN,
})
export const databaseId = process.env.RETRYABLE_MONITORING_NOTION_DB_ID!
