# Retryable Monitor

> For installation and general configuration, see the [main README](../../README.md).

## Overview

The Retryable Monitor tracks ParentChain->ChildChain message execution through retryable tickets. These tickets are the primary mechanism for cross-chain communication in Arbitrum. [Learn more](https://docs.arbitrum.io/arbos/l1-to-l2-messaging).

## Command-Line Interface

```bash
yarn retryable-monitor [options]

Monitor retryable tickets on Arbitrum chains

Options:
  --help             Show help                                         [boolean]
  --version          Show version number                               [boolean]
  --configPath       Path to config file                               [string] [default: "config.json"]
  --enableAlerting   Enable Slack alerts                               [boolean] [default: false]
  --fromBlock        Starting block number for monitoring              [number]
  --toBlock          Ending block number for monitoring                [number]
  --continuous       Run monitor continuously                          [boolean] [default: false]

Examples:
  yarn retryable-monitor --continuous                    Run continuous monitoring
  yarn retryable-monitor --fromBlock=1000 --toBlock=2000 Check specific block range
  yarn retryable-monitor --enableAlerting               Enable Slack notifications

Environment Variables:
  RETRYABLE_MONITORING_SLACK_TOKEN    Slack API token for alerts
  RETRYABLE_MONITORING_SLACK_CHANNEL  Slack channel for alerts
```

## Monitor Details

Retryable tickets are Arbitrum's mechanism for guaranteed ParentChain->ChildChain message delivery. When a message is sent from the parent chain to the child chain, it creates a retryable ticket that must be executed within 7 days. This monitor tracks these tickets from creation through execution, ensuring no messages are lost or expire unexecuted.

The monitoring process spans both parent and child chains. On the parent chain, we watch for new ticket creation events that indicate a message needs to be delivered to the child chain. Once created, tickets can be redeemed either automatically by the system or manually by users. The monitor tracks both types of redemption attempts and their outcomes.

Each ticket can trigger alerts based on several risk factors: approaching the 7-day expiration window, failed redemption attempts, gas-related issues preventing execution, or tickets stuck in pending state. These alerts help prevent message delivery failures that could impact cross-chain operations.

### Critical Events

The monitor tracks five key events that represent state transitions:

- `RetryableTicketCreated`: A new ParentChain->ChildChain message has been created and funded
- `RedeemScheduled`: A redemption attempt has been initiated
- `TicketRedeemed`: The message has been successfully executed on ChildChain
- `AutoRedemptionSuccess`: Automatic redemption system successfully executed the message
- `AutoRedemptionFailed`: Automatic redemption attempt failed, manual intervention may be needed

### Alert Scenarios

The monitor generates alerts in these critical scenarios:

- Execution Failures: Both automatic and manual redemption attempts that fail
- Expiration Risk: Tickets older than 6 days that haven't been executed
- Gas Issues: When execution fails due to insufficient gas or high gas prices
- Stuck Messages: Tickets that remain in a pending state without progress

This comprehensive monitoring ensures that cross-chain message delivery remains reliable and no messages are lost due to expiration or execution failures.
