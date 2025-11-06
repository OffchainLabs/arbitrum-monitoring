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
  - When `true` (default): Sends **one consolidated summary message** at the end with all down chains listed. No individual alerts are sent during chain checks.
  - When `false` (`--no-consolidateAlerts`): Sends **individual Slack messages** immediately when each chain goes down. No consolidated summary is sent.

## Output

The monitor provides:

- Console logs for each chain check (both up and down)
- Summary statistics (total, up, down)
- Exit code 1 if any chains are down
- Slack alerts (if enabled):
  - **Only alerts for down chains** - no alerts sent if all chains are up
  - **Consolidated mode (`--consolidateAlerts`, default)**:
    - Waits until all chains are checked
    - Sends **one summary message** with total chains, up/down counts, and list of all down chains
    - Example: "❌ Chain Uptime Alert\n\nTotal Chains: 4\n✅ Up: 3\n❌ Down: 1\n\nDown Chains:\n - Chain 2 (1002): Connection timeout"
  - **Individual mode (`--no-consolidateAlerts`)**:
    - Sends **separate message for each down chain** immediately when detected
    - Example: "❌ Chain Uptime Alert: Chain 2 (Chain ID: 1002) is DOWN\nError: Connection timeout\n..."
