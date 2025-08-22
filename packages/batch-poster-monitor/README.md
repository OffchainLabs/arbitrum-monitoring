# Batch Poster Monitor

> For installation and general configuration, see the [main README](../../README.md).

## Overview

The Batch Poster Monitor tracks batch posting performance, data compression, and poster account balance.

## Command-Line Interface

```bash
yarn batch-poster-monitor [options]

Monitor batch posting activity on Arbitrum chains

Options:
  --help             Show help                         [boolean]
  --version          Show version number               [boolean]
  --configPath       Path to config file               [string] [default: "config.json"]
  --enableAlerting   Enable Slack alerts               [boolean] [default: false]

Examples:
  yarn batch-poster-monitor                            Run with default config
  yarn batch-poster-monitor --enableAlerting           Enable Slack notifications
  yarn batch-poster-monitor --configPath=custom.json   Use custom config file

Environment Variables:
  BATCH_POSTER_MONITORING_SLACK_TOKEN    Slack API token for alerts
  BATCH_POSTER_MONITORING_SLACK_CHANNEL  Slack channel for alerts
```

## Monitor Details

The Batch Poster Monitor is crucial for ensuring that transaction data is reliably posted to the parent chain, maintaining the chain's data availability guarantees. It monitors the batch posting process, which involves compressing transaction data and submitting it to the parent chain, while also tracking the batch poster's account balance to ensure uninterrupted operation.

### Critical Events

The monitor tracks several key metrics and events:

- Batch posting frequency and timing
- Data compression ratios
- Poster account balance and gas costs
- AnyTrust committee participation
- Backlog accumulation

### Alert Scenarios

The monitor generates alerts in these critical scenarios:

#### Batch Posting Delays
- No batches posted within 24 hours AND pending user transactions exist
- Time since last batch post exceeds chain-specific time bounds:
  - Default: 4 hours
  - Customized based on `maxTimeVariation` contract setting
  - Minimum: 1 hour
  - Maximum: Chain's time bounds minus buffer

#### Batch Poster Balance
- Current balance falls below minimum required for 3 days of operation
- Calculation based on:
  - Rolling 24-hour gas cost average
  - Current balance / daily posting cost estimate
  - Fallback threshold: Static check if no recent activity

#### AnyTrust-Specific
- Committee failure detection:
  - Chain reverted to posting full calldata on-chain (0x00 prefix)
  - Indicates potential Data Availability Committee issues
- Expected format: DACert (0x88 prefix)

#### Backlog Detection
- Non-zero block backlog AND last batch posted > time bounds ago
- Backlog measured as: `latestChildChainBlockNumber - lastBlockReported`

#### Processing Errors
- Chain RPC connectivity issues
- Contract interaction failures
- Invalid response formats
- Rate limiting errors

## Configuration

### Ignore List

The monitor can ignore specific transaction types based on their function selectors. This is configured in `packages/batch-poster-monitor/ignoreList.ts`:

```typescript
const defaultIgnoreList: Record<number, string[]> = {
  51828: ['0x8d80ff0a'], // ChainBounty - ignores multiSend(bytes) transactions
}
```

The ignore system works by:
- Checking the first 4 bytes (function selector) of each transaction
- Skipping monitoring if the selector is in the ignore list for that chain
- Logging when transactions are ignored: `Chain [ChainName]: Ignoring transaction with function selector 0x...`

Common function selectors:
- `0x8d80ff0a` - multiSend(bytes) - Used by multi-signature wallets for batch transactions

This is useful for:
- Chains using multi-sig wallets for batch posting
- Ignoring specific transaction types that don't require monitoring
- Reducing false positive alerts from expected transaction patterns

Each alert includes:
- Chain name and ID
- Relevant contract addresses
- Specific threshold violations
- Time since last successful operation
- Current system state metrics
