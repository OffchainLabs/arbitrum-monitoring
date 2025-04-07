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
  --writeToNotion	   Sync ticket metadata to Notion	                   [boolean] [default: false]

Examples:
  yarn retryable-monitor --continuous                    Run continuous monitoring
  yarn retryable-monitor --fromBlock=1000 --toBlock=2000 Check specific block range
  yarn retryable-monitor --enableAlerting --writeToNotion           Enable Slack notifications and writes to Notion

Environment Variables:
  RETRYABLE_MONITORING_SLACK_TOKEN    Slack API token for alerts
  RETRYABLE_MONITORING_SLACK_CHANNEL  Slack channel for alerts
  RETRYABLE_MONITORING_NOTION_TOKEN   Notion integration token
  RETRYABLE_MONITORING_NOTION_DB_ID   Notion database ID
```

## Monitoring Behavior

When `--continuous` is enabled, the monitor:

✅ Watches for new retryable tickets every 3 minutes
✅ Optionally writes ticket data to Notion (`--writeToNotio`n)
✅ Sends Slack alerts for risky tickets (`--enableAlerting`)
✅ Runs a Notion DB sweep every 1 hour to:
- Mark tickets as "Expired" if older than 7 days
- Alert if tickets are under 24h from expiry and still "Untriaged" or "Investigating"

## Monitor Details

Here’s an updated version of your **Monitor Details** section, reflecting the current functionality — including Notion sync, periodic expiration checks, and alert logic:

---

## Monitor Details

Retryable tickets are Arbitrum's mechanism for guaranteed `ParentChain → ChildChain` message delivery. When a message is sent from the parent chain to the child chain, it creates a **retryable ticket** that must be executed within 7 days. This monitor tracks those tickets from creation through execution, ensuring that no messages are lost or expire unexecuted.

The monitoring process spans both parent and child chains:
- On the **parent chain**, it listens for `MessageDelivered` events that indicate a retryable ticket has been created.
- On the **child chain**, it checks the status of each ticket, including whether it was successfully redeemed (automatically or manually), still pending, or failed.

If `--writeToNotion` is enabled, each detected ticket is written to a Notion database with metadata such as creation time, gas information, callvalue, token deposit amount, and expiration timestamp.

If `--enableAlerting` is enabled, the monitor sends Slack alerts based on key risk factors:
- Retryables nearing expiration (less than 24 hours remaining)
- Tickets that failed to redeem automatically or manually
- Tickets with unusually high gas usage or stuck execution

Additionally, the monitor includes a background **Notion DB sweep** that runs every hour to:
- Automatically mark retryable tickets as `"Expired"` if more than 7 days have passed without redemption
- Alert on tickets close to expiration that are still `"Untriaged"` or `"Investigating"`

This dual-layer monitoring system ensures cross-chain messages are reliably delivered and that at-risk messages are surfaced for action before expiration.

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


## About the Notion Database

The Notion database serves as a central triage system for tracking the status, metadata, and resolution lifecycle of retryable tickets across Orbit chains. When the monitor is run with --`writeToNotion`, each unredeemed ticket is logged to the database with structured metadata to help engineering teams investigate, prioritize, and take action where needed.

Successfully redeemed tickets are intentionally excluded to keep the database focused on actionable items — such as retryables that are stuck, failed, or at risk of expiration. This human-readable record complements chain logs and Slack alerts, and powers downstream automations like automatic expiration marking and alert suppression based on triaged status.

### Required Columns

The Notion database should be configured with the following columns:

| **Column**           | **Type**     | **Description**                                                                 |
|----------------------|--------------|---------------------------------------------------------------------------------|
| `ID`                 | Rich text    | The retryable ticket ID (L2 transaction hash)                                   |
| `ParentTx`           | URL          | Link to the parent chain transaction that created the retryable                |
| `ChildTx`            | URL          | Link to the child chain transaction (if available)                              |
| `Created At`         | Date         | Timestamp (ms) when the retryable was created                                   |
| `timeout`            | Number       | Expiration timestamp in milliseconds                                            |
| `Status`             | Select       | Workflow status (`Untriaged`, `Investigating`, `Expired`, etc.)                |
| `Priority`           | Select       | Optional manual priority (`High`, `Medium`, `Low`, `Unset`)                    |
| `tokensDeposited`    | Text         | Amount, symbol, and token address (e.g. `1.23 USDC ($1.23) (0xToken...)`)      |
| `gasPriceProvided`   | Text         | Gas price submitted when the ticket was created                                |
| `gasPriceAtCreation` | Text         | L2 gas price at the time of ticket creation                                    |
| `gasPriceNow`        | Text         | Current L2 gas price                                                            |
| `l2CallValue`        | Text         | ETH or native callvalue (e.g. `0.0001 ETH ($0.18)`)                             |
