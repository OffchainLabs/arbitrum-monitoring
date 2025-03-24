# Assertion Monitor

> For installation and general configuration, see the [main README](../../README.md).

## Overview

The Assertion Monitor validates chain security by tracking the lifecycle of assertions in both BOLD (Bounded Liquidity Delay) and Classic rollup chains. [Learn more](https://docs.arbitrum.io/how-arbitrum-works/inside-arbitrum-nitro#arbitrum-rollup-protocol).

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

The Assertion Monitor tracks assertions through their lifecycle, implementing distinct strategies for BOLD and pre-BoLD rollup chains.

### Critical Events Monitored

- Creation Events: Assertions and node creation
- Confirmation Events: Assertion/node confirmations
- Validator Events: Stake changes and status updates
- Block Events: Creation rates and finalization
- Chain State: Consistency and synchronization

### Chain-Specific Features

- BOLD Chains: Base stake monitoring, finality validation, challenge period tracking
- Classic Chains: Whitelist validation, basic activity tracking, adjusted thresholds

### Alert Scenarios

#### Creation Issues
- Missing assertion creation events
- Chain activity without recent assertions
- Non-BOLD node creation gaps
- Validator participation tracking

#### Confirmation Issues
- Parent chain block threshold delays
- Challenge period exceeded events
- Confirmation block inconsistencies
- Unconfirmed assertion buildup

#### Other Issues
- Whitelist status (Classic chains)
- Base stake thresholds (BOLD chains)
- Chain synchronization issues
- State consistency validation

For implementation details and thresholds, see `alerts.ts` and `monitoring.ts`.
