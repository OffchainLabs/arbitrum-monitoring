import { alertUntriagedNotionRetryables } from './notion/alertUntriagedRetryables'

const run = async () => {
  try {
    console.log('🔎 Running Notion retryable sweep...')
    await alertUntriagedNotionRetryables()
    console.log('✅ Sweep complete.')
  } catch (err) {
    console.error(`❌ Sweep failed: ${(err as Error).message}`)
    process.exit(1)
  }
}

run()
