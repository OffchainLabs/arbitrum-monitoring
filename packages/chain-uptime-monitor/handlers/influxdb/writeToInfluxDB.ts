import { InfluxDB, Point } from '@influxdata/influxdb-client'
import { ChainUptimeResult } from '../../core/types'

interface InfluxDBConfig {
  url: string // InfluxDB URL (e.g., https://us-east-1-1.aws.cloud2.influxdata.com)
  token: string // InfluxDB API token
  org: string // Organization name
  bucket: string // Bucket name
}

let influxClient: InfluxDB | null = null
let writeApi: ReturnType<InfluxDB['getWriteApi']> | null = null

export const initializeInfluxDB = (config: InfluxDBConfig): void => {
  if (!config.url || !config.token || !config.org || !config.bucket) {
    console.warn('InfluxDB config incomplete, skipping initialization')
    return
  }

  try {
    influxClient = new InfluxDB({
      url: config.url,
      token: config.token,
    })

    writeApi = influxClient.getWriteApi(config.org, config.bucket, 'ns')
    writeApi.useDefaultTags({ source: 'chain-uptime-monitor' })

    console.log('✅ InfluxDB initialized successfully')
  } catch (error) {
    console.error('❌ Failed to initialize InfluxDB:', error)
    influxClient = null
    writeApi = null
  }
}

export const writeUptimeResultToInfluxDB = async (
  result: ChainUptimeResult
): Promise<void> => {
  if (!writeApi) {
    return // InfluxDB not initialized or disabled
  }

  try {
    const point = new Point('chain_uptime')
      .tag('chain_id', result.chainId.toString())
      .tag('chain_name', result.chainName)
      .tag('rpc_url', result.rpcUrl)
      .booleanField('is_running', result.isRunning)
      .timestamp(new Date())

    if (result.blockNumber !== undefined) {
      point.intField('block_number', Number(result.blockNumber))
    }

    if (result.responseTime !== undefined) {
      point.intField('response_time_ms', result.responseTime)
    }

    if (result.error) {
      point.stringField('error', result.error)
    }

    writeApi.writePoint(point)
    await writeApi.flush()

    console.log(
      `📊 Wrote uptime data to InfluxDB for ${result.chainName} (${result.chainId})`
    )
  } catch (error) {
    console.error(
      `❌ Failed to write to InfluxDB for ${result.chainName}:`,
      error
    )
  }
}

export const closeInfluxDB = async (): Promise<void> => {
  if (writeApi) {
    try {
      await writeApi.close()
      console.log('✅ InfluxDB connection closed')
    } catch (error) {
      console.error('❌ Error closing InfluxDB connection:', error)
    }
    writeApi = null
  }
  influxClient = null
}
