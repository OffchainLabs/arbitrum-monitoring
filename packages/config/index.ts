import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: '../../.env' })

// config.json file at project root
export const DEFAULT_CONFIG_PATH = '../../config.json'

export const getConfig = (options: { configPath: string }) => {
  // Read the content of the config file
  const configFileContent = fs.readFileSync(
    path.join(process.cwd(), options.configPath),
    'utf-8'
  )

  // Parse the config file content as JSON
  const config = JSON.parse(configFileContent)

  // Check if childChains array is present in the config file
  if (!Array.isArray(config.childChains)) {
    console.error('Error: Child chains not found in the config file.')
    process.exit(1)
  }

  return config
}
