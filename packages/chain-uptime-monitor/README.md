# Chain Uptime Monitor

A simple, efficient module for monitoring Arbitrum chain uptime by pinging RPC endpoints.

## Overview

The Chain Uptime Monitor checks if Arbitrum chains are running by attempting to fetch the latest block number from their RPC endpoints. It provides a modular, SDK-like approach with callbacks for success and error scenarios.

## Features

- ✅ Simple RPC health check via `getBlockNumber()`
- 🔔 Slack alerts only for down chains (consolidated by default)
- 📊 Summary reporting
- 🔌 Modular design with callbacks for extensibility
- ⚡ Concurrent chain checking
- 🎯 Configurable timeout (default: 10 seconds)

## Usage

### CLI

```bash
# Basic usage
yarn chain-uptime-monitor

# With custom config path
yarn chain-uptime-monitor --configPath ./custom-config.json

# With Slack alerting enabled (consolidated alerts by default)
yarn chain-uptime-monitor --enableAlerting

# With individual alerts per chain (disable consolidation)
yarn chain-uptime-monitor --enableAlerting --no-consolidateAlerts
```

### SDK-like Usage

```typescript
import { isChainRunning } from 'chain-uptime-monitor'
import { ChainUptimeConfig } from 'chain-uptime-monitor'

const config: ChainUptimeConfig = {
  chain: {
    name: 'My Chain',
    chainId: 421614,
    orbitRpcUrl: 'https://my-chain-rpc.com',
    // ... other chain metadata
  },
  timeout: 10000, // optional, default 10s
}

// With callbacks
const result = await isChainRunning(
  config,
  // onSuccess callback
  async (result) => {
    console.log(`Chain is up! Block: ${result.blockNumber}`)
    // Log to database, etc.
  },
  // onError callback
  async (result) => {
    console.error(`Chain is down! Error: ${result.error}`)
    // Send Slack alert, etc.
  }
)

// Without callbacks
const result = await isChainRunning(config)
console.log(result.isRunning ? 'UP' : 'DOWN')
```

## Configuration

The monitor uses the same `config.json` format as other monitors:

```json
{
  "childChains": [
    {
      "name": "Arbitrum Sepolia",
      "chainId": 421614,
      "parentChainId": 11155111,
      "orbitRpcUrl": "https://sepolia-rollup.arbitrum.io/rpc",
      "explorerUrl": "https://sepolia.arbiscan.io",
      "parentExplorerUrl": "https://sepolia.etherscan.io"
    }
  ]
}
```

## Environment Variables

- `CHAIN_UPTIME_MONITORING_SLACK_TOKEN`: Slack bot token for alerts
- `CHAIN_UPTIME_MONITORING_SLACK_CHANNEL`: Slack channel ID for alerts

## Options

- `--configPath`: Path to configuration file (default: "config.json")
- `--enableAlerting`: Enable Slack alerts (default: false)
- `--consolidateAlerts`: Consolidate all alerts into a single message (default: true)
  - When `true`: Sends one consolidated summary message only if there are down chains
  - When `false`: Sends individual messages for each down chain

## Output

The monitor provides:
- Console logs for each chain check (both up and down)
- Summary statistics (total, up, down)
- Exit code 1 if any chains are down
- Slack alerts (if enabled):
  - **Only alerts for down chains** - no alerts sent if all chains are up
  - **Consolidated mode (default)**: Single summary message with down chains only
  - **Individual mode**: Separate message for each down chain

## Integration

This monitor is designed to run via GitHub Actions every 4 hours, using the same config generation pattern as other monitors.

