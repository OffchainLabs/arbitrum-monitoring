# Arbitrum Monitoring

## Overview

This monitoring suite helps you track the health and performance of your Arbitrum chains through three specialized monitors:

1. [**Retryable Monitor**](./packages/retryable-monitor/README.md) - Tracks ParentChain->ChildChain message execution and retryable ticket lifecycle
2. [**Batch Poster Monitor**](./packages/batch-poster-monitor/README.md) - Monitors batch posting and data availability
3. [**Assertion Monitor**](./packages/assertion-monitor/README.md) - Monitor assertion creation and validation on Arbitrum chains

Each monitor has its own detailed documentation with technical specifics and implementation details.

## Prerequisites

- Node.js v18 or greater
- Yarn package manager
- Access to Arbitrum chain RPC endpoints
- Access to parent chain RPC endpoints
- Slack workspace for alerts (optional)

## Installation

1. Clone and install dependencies:

```bash
git clone https://github.com/OffchainLabs/arbitrum-monitoring.git
cd arbitrum-monitoring
yarn install
```

## Configuration

### Chain Configuration

1. Copy and edit the config file:

```bash
cp config.example.json config.json
```

2. Configure your chains in `config.json`:

```json
{
  "childChains": [
    {
      "name": "Your Chain Name",
      "chainId": 421614,
      "parentChainId": 11155111,
      "confirmPeriodBlocks": 45818,
      "parentRpcUrl": "https://your-parent-chain-rpc",
      "orbitRpcUrl": "https://your-chain-rpc",
      "ethBridge": {
        "bridge": "0x...",
        "inbox": "0x...",
        "outbox": "0x...",
        "rollup": "0x...",
        "sequencerInbox": "0x..."
      }
    }
  ]
}
```

### Alert Configuration

1. Copy and configure the environment file:

```bash
cp .env.sample .env
```

2. Set up Slack alerts in `.env` (optional):

```bash
NODE_ENV=CI
RETRYABLE_MONITORING_SLACK_TOKEN=your-slack-token
RETRYABLE_MONITORING_SLACK_CHANNEL=your-slack-channel
BATCH_POSTER_MONITORING_SLACK_TOKEN=your-slack-token
BATCH_POSTER_MONITORING_SLACK_CHANNEL=your-slack-channel
ASSERTION_MONITORING_SLACK_TOKEN=your-slack-token
ASSERTION_MONITORING_SLACK_CHANNEL=your-slack-channel
```

## Usage

All monitors support these base options:

- `--configPath`: Path to configuration file (default: "config.json")
- `--enableAlerting`: Enable Slack alerts (default: false)

### Quick Start Commands

```bash
# Monitor retryable tickets
yarn retryable-monitor [options]

# Monitor batch posting
yarn batch-poster-monitor [options]

# Monitor chain assertions
yarn assertion-monitor [options]
```

See individual monitor READMEs for specific options and features:

- [Retryable Monitor Details](./packages/retryable-monitor/README.md)
- [Batch Poster Monitor Details](./packages/batch-poster-monitor/README.md)
- [Assertion Monitor Details](./packages/assertion-monitor/README.md)
