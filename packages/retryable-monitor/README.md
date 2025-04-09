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

✅ Optionally writes ticket data to Notion (`--writeToNotion`)  
  • If the ticket is **new**, it is written with status `"Untriaged"`  
  • If the ticket already exists, **only metadata is updated** — the `Status` is **preserved** unless it's still `"Untriaged"` or blank

✅ Sends Slack alerts for tickets close to expiry (`--enableAlerting`)

✅ Runs a Notion DB sweep every 24 hours to:

- Mark tickets as `"Expired"` if older than 7 days
- Alert if tickets are under 2 days from expiry and still `"Untriaged"` or `"Investigating"`


## Monitor Details

Retryable tickets are Arbitrum’s mechanism for guaranteed ParentChain → ChildChain message delivery. When a message is sent from the parent chain to the child chain, it creates a retryable ticket that must be executed within 7 days. This monitor tracks those tickets from creation through execution, ensuring that no messages are lost or expire unexecuted.

The monitoring process spans both parent and child chains:

- On the parent chain, it listens for `MessageDelivered` events that indicate a retryable ticket has been created.
- On the child chain, it checks the status of each ticket, including whether it was successfully redeemed (automatically or manually), still pending, or failed.

If `--writeToNotion` is enabled, each detected ticket is written to a Notion database with metadata such as creation time, gas information, callvalue, token deposit amount, and expiration timestamp.

If `--enableAlerting` is enabled, the monitor sends Slack alerts only for tickets that are close to expiration (less than 2 days remaining) and still marked as "Untriaged" or "Investigating" in Notion.

Additionally, the monitor includes a background Notion DB sweep that runs every 24 hours to:

- Automatically mark retryable tickets as "Expired" if more than 7 days have passed without redemption
- Alert on tickets close to expiration that are still "Untriaged" or "Investigating"

This dual-layer monitoring ensures cross-chain messages are reliably delivered and that at-risk messages are surfaced for action before expiration.

### Critical Events

The monitor tracks five key events that represent state transitions:

- `RetryableTicketCreated`: A new ParentChain->ChildChain message has been created and funded
- `RedeemScheduled`: A redemption attempt has been initiated
- `TicketRedeemed`: The message has been successfully executed on ChildChain
- `AutoRedemptionSuccess`: Automatic redemption system successfully executed the message
- `AutoRedemptionFailed`: Automatic redemption attempt failed, manual intervention may be needed

### Alert Scenarios

Slack alerts are triggered only when:

- A retryable ticket is within 2 days of expiration
- And its Notion Status is either "Untriaged" or "Investigating"

`Redeemed`, `resolved`, or `expired` retryables are not alerted.

## About the Notion Database


The Notion database serves as a central triage system for tracking the status, metadata, and resolution lifecycle of retryable tickets across Orbit chains.

When the monitor is run with `--writeToNotion`:

- Each unredeemed ticket is written to the database **once**, with structured metadata (gas, tokens, callvalue, etc.)
- If the ticket already exists, it is **updated with fresh metadata** but its `Status` field is **preserved** unless it's still `"Untriaged"` or missing

This allows the responsible team to manually triage tickets (e.g., mark as `"Investigating"` or `"Resolved"`) without that work being accidentally overwritten on the next run.

Slack alerts are only sent for retryables that are:

- Still `"Untriaged"` or `"Investigating"`
- Within 2 days of expiration
- Not already marked as `"Resolved"` or `"Expired"`

Successfully redeemed tickets are intentionally excluded to keep the database focused on actionable items—such as retryables that are stuck, failed, or at risk of expiration.

### Required Columns

The Notion database should be configured with the following columns:

| **Column**           | **Type** | **Description**                                                           |
| -------------------- | -------- | ------------------------------------------------------------------------- |
| `ParentTx`           | URL      | Link to the parent chain transaction that created the retryable           |
| `ChildTx`            | URL      | Link to the child chain transaction (if available)                        |
| `CreatedAt`          | Date     | Timestamp (ms) when the retryable was created                             |
| `Timeout`            | Number   | Expiration timestamp in milliseconds                                      |
| `Status`             | Select   | Workflow status (`Untriaged`, `Investigating`, `Expired`, `Resolved`.)    |
| `Priority`           | Select   | Optional manual priority (`High`, `Medium`, `Low`, `Unset`)               |
| `TokensDeposited`    | Text     | Amount, symbol, and token address (e.g. `1.23 USDC ($1.23) (0xToken...)`) |
| `GasPriceProvided`   | Text     | Gas price submitted when the ticket was created                           |
| `GasPriceAtCreation` | Text     | L2 gas price at the time of ticket creation                               |
| `gasPriceNow`        | Text     | Current L2 gas price                                                      |
| `L2CallValue`        | Text     | ETH or native callvalue (e.g. `0.0001 ETH ($0.18)`)                       |
