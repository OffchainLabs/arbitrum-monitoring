import { Client } from '@notionhq/client'
import { QueryDatabaseResponse } from '@notionhq/client/build/src/api-endpoints'
import dotenv from 'dotenv'

dotenv.config()

const notion = new Client({ auth: process.env.NOTION_API_KEY })
const databaseId = process.env.NOTION_DB_ID!

export const getNotionTicketStatus = async (
  l2TicketId: string
): Promise<string | undefined> => {
  try {
    const response: QueryDatabaseResponse = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: 'ID', // change this if your Notion property is named differently
        rich_text: {
          equals: l2TicketId,
        },
      },
    })

    const page = response.results[0]
    if (!page) return undefined

    const statusProp = (page as any).properties['Status']
    if (
      statusProp &&
      statusProp.select &&
      typeof statusProp.select.name === 'string'
    ) {
      return statusProp.select.name
    }

    return undefined
  } catch (error) {
    console.error(`Error fetching ticket status from Notion: ${error}`)
    return undefined
  }
}
