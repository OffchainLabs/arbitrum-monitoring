import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: '../../.env' })

// config.json file at project root
export const DEFAULT_CONFIG_PATH = '../../config.json'

export const getConfig = (options: { configPath: string }) => {
  try {
    const configFileContent = fs.readFileSync(
      path.join(process.cwd(), options.configPath),
      'utf-8'
    )

    const parsedConfig = JSON.parse(configFileContent)

    return parsedConfig
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON in the config file')
    }
    if (error instanceof Error) {
      throw new Error(`Error reading or parsing config file: ${error.message}`)
    }
    throw new Error(
      'An unknown error occurred while processing the config file'
    )
  }
}
