# Arbitrum Monitoring

## Overview

This monitoring suite helps you track the health and performance of your Arbitrum chains through three specialized monitors:

1. [**Retryable Monitor**](./packages/retryable-monitor/README.md) - Tracks ParentChain->ChildChain message execution and retryable ticket lifecycle
2. [**Batch Poster Monitor**](./packages/batch-poster-monitor/README.md) - Monitors batch posting and data availability
3. [**Assertion Monitor**](./packages/assertion-monitor/README.md) - Monitor assertion creation and validation on Arbitrum chains
4. [**ArbOS Version Monitor**](./packages/arbos-version-monitor/README.md) - Checks that chains run at least a minimum ArbOS version

Each monitor has its own detailed documentation with technical specifics and implementation details.

## Prerequisites

- Node.js v18 or greater
- pnpm package manager
- Access to Arbitrum chain RPC endpoints
- Access to parent chain RPC endpoints
- Slack workspace for alerts (optional)

## Installation

1. Clone and install dependencies:

```bash
git clone https://github.com/OffchainLabs/arbitrum-monitoring.git
cd arbitrum-monitoring
pnpm install
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

2. Set up Slack alerts in `.env` (optional). For each monitor, set either a webhook URL (preferred, scoped to a single channel) or a token + channel; the webhook takes precedence if both are set:

```bash
NODE_ENV=CI
RETRYABLE_MONITORING_SLACK_WEBHOOK_URL=your-slack-webhook-url
RETRYABLE_MONITORING_SLACK_TOKEN=your-slack-token
RETRYABLE_MONITORING_SLACK_CHANNEL=your-slack-channel
BATCH_POSTER_MONITORING_SLACK_WEBHOOK_URL=your-slack-webhook-url
BATCH_POSTER_MONITORING_SLACK_TOKEN=your-slack-token
BATCH_POSTER_MONITORING_SLACK_CHANNEL=your-slack-channel
ASSERTION_MONITORING_SLACK_WEBHOOK_URL=your-slack-webhook-url
ASSERTION_MONITORING_SLACK_TOKEN=your-slack-token
ASSERTION_MONITORING_SLACK_CHANNEL=your-slack-channel
ARBOS_VERSION_MONITORING_SLACK_TOKEN=your-slack-token
ARBOS_VERSION_MONITORING_SLACK_CHANNEL=your-slack-channel
```

Required environment variables:

- `RETRYABLE_MONITORING_NOTION_TOKEN`: Notion API token for database integration
- `RETRYABLE_MONITORING_NOTION_DB_ID`: Notion database ID for storing retryable tickets

## Usage

All monitors support these base options:

- `--configPath`: Path to configuration file (default: "config.json")
- `--enableAlerting`: Enable Slack alerts (default: false)

### Quick Start Commands

```bash
# Monitor retryable tickets
pnpm retryable-monitor [options]

# Monitor batch posting
pnpm batch-poster-monitor [options]

# Monitor chain assertions
pnpm assertion-monitor [options]

# Monitor ArbOS versions
pnpm arbos-version-monitor [options]
```

See individual monitor READMEs for specific options and features:

- [Retryable Monitor Details](./packages/retryable-monitor/README.md)
- [Batch Poster Monitor Details](./packages/batch-poster-monitor/README.md)
- [Assertion Monitor Details](./packages/assertion-monitor/README.md)
- [ArbOS Version Monitor Details](./packages/arbos-version-monitor/README.md)

### Notion Integration

When `--writeToNotion` is enabled, the monitor will:

- Create new pages in the Notion database for each retryable ticket
- Update existing pages when ticket status changes
- Run a daily sweep to mark expired tickets
- Track ticket status, creation time, expiration time, and transaction hashes

The Notion database should have the following properties:

- Ticket ID (title)
- Status (select)
- Created At (date)
- Expires At (date)
- Transaction Hash (url)
- Last Updated (date)
