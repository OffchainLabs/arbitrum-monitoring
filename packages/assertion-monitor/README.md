# Assertion Monitor

> For installation and general configuration, see the [main README](../../README.md).

## Overview

The Assertion Monitor monitors the lifecycle of assertions in both BoLD (Bounded Liquidity Delay) and pre-BoLD rollup chains. [Learn more](https://docs.arbitrum.io/how-arbitrum-works/inside-arbitrum-nitro#arbitrum-rollup-protocol).

## Command-Line Interface

```bash
yarn assertion-monitor [options]

Monitor assertion creation and validation on Arbitrum chains

Options:
  --help             Show help                      [boolean]
  --version          Show version number            [boolean]
  --configPath       Path to config file            [string] [default: "config.json"]
  --enableAlerting   Enable Slack alerts            [boolean] [default: false]

Examples:
  yarn assertion-monitor                            Run with default config
  yarn assertion-monitor --enableAlerting           Enable Slack notifications
  yarn assertion-monitor --configPath=custom.json   Use custom config file

Environment Variables:
  ASSERTION_MONITORING_SLACK_TOKEN    Slack API token for alerts
  ASSERTION_MONITORING_SLACK_CHANNEL  Slack channel for alerts
```

## Monitor Details

The Assertion Monitor tracks assertions through their lifecycle, implementing distinct strategies for BoLD and pre-BoLD rollup chains.

### Critical Events Monitored

The monitor tracks five categories of blockchain events:

- **Creation Events**: Records when new assertions and nodes are created on the chain to verify transaction execution
- **Confirmation Events**: Identifies when assertions are confirmed on the parent chain after challenge periods end
- **Validator Events**: Tracks validator participation metrics including stakes, challenges, and whitelist status
- **Block Events**: Monitors block production rates, finalization timing, and synchronization between chains
- **Chain State**: Analyzes the overall consistency between on-chain state and expected protocol behavior

### Alert Scenarios

The monitor triggers alerts when these conditions are detected:

#### Creation Issues

- No assertion creation events within configured time window
- Chain activity without corresponding recent assertions
- Extended node creation gaps on non-BoLD chains
- Validator participation below required thresholds

#### Confirmation Issues

- Parent chain block threshold exceeded
- Assertions stuck in challenge period
- Data inconsistencies between confirmation events and confirmed blocks
- Confirmation events missing despite available creation events

#### Other Issues

- Validator whitelist disabled on pre-BoLD chains
- Base stake below 1 ETH threshold on BoLD chains
- Parent-child chain synchronization anomalies
- State inconsistencies between expected and observed chain state

For implementation details and thresholds, see `alerts.ts` and `monitoring.ts`.
