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
  yarn retryable-monitor --enableAlerting --writeToNotion           Enables Slack alerts and syncs retryable data to Notion

Environment Variables:
  RETRYABLE_MONITORING_SLACK_TOKEN    Slack API token for alerts
  RETRYABLE_MONITORING_SLACK_CHANNEL  Slack channel for alerts
  RETRYABLE_MONITORING_NOTION_TOKEN   Notion integration token
  RETRYABLE_MONITORING_NOTION_DB_ID   Notion database ID
```

## Monitoring Behavior

By default, the monitor runs once. You can pass `--continuous` to keep it running.

✅ Finds retryable tickets
✅ Writes to Notion if `--writeToNotion` is used:
  • New tickets are marked `Untriaged`
  • Existing tickets update metadata only
✅ Sends Slack alerts for new tickets added to Notion if both `--writeToNotion` and `--enableAlerting` are used

When `--continuous` is on, it also:

✅ Checks for new tickets every 3 minutes
✅ Sweeps the Notion DB every 24 hours to:
  • Mark tickets as "Expired" after 7 days
  • Alert on tickets expiring soon and still `Untriaged` or `Investigating`

## Monitor Details

Retryable tickets are Arbitrum’s mechanism for guaranteed ParentChain → ChildChain message delivery. When a message is sent from the parent chain to the child chain, it creates a retryable ticket that must be executed within 7 days. This monitor tracks those tickets from creation through execution, ensuring that no messages are lost or expire unexecuted.

The monitoring process spans both parent and child chains:

- On the parent chain, it listens for `MessageDelivered` events that indicate a retryable ticket has been created.

- On the child chain, it checks the status of each ticket, including whether it was successfully redeemed (automatically or manually), still pending, or failed.

If `--writeToNotion` is enabled, each detected ticket is written to a Notion database with metadata such as creation time, gas information, callvalue, token deposit amount, and expiration timestamp.

- If both --`writeToNotion` and `--enableAlerting` are enabled, the monitor sends a Slack alert the first time a new retryable is added to Notion with status `Untriaged`.

When running in `--continuous` mode, the monitor also performs a Notion sweep every 24 hours to:

- Mark tickets as `Expired` if more than 7 days have passed without redemption.

- Alert on tickets that are close to expiring (less than 2 days left) and still marked as `Untriaged` or `Investigating`.

This dual-layer monitoring ensures cross-chain messages are reliably delivered and that at-risk tickets are surfaced for action before expiration.

### Critical Events

The monitor tracks five key events that represent state transitions:

- `RetryableTicketCreated`: A new ParentChain->ChildChain message has been created and funded
- `RedeemScheduled`: A redemption attempt has been initiated
- `TicketRedeemed`: The message has been successfully executed on ChildChain
- `AutoRedemptionSuccess`: Automatic redemption system successfully executed the message
- `AutoRedemptionFailed`: Automatic redemption attempt failed, manual intervention may be needed

### Alert Scenarios

By default, Slack alerts are not sent.

If `--enableAlerting` is used without `--writeToNotion`, alerts are only sent when errors occur during processing (e.g., RPC failures or unexpected exceptions).

When used with `--writeToNotion`, Slack alerts are more advanced. See the next section for details — including alerts for new retryables and tickets close to expiration based on Notion status.

## About the Notion Database

The Notion database acts as a shared triage board for tracking retryable ticket status and metadata across Orbit chains.

When the monitor is run with `--writeToNotion`:

- Each unredeemed ticket is written to Notion once, with structured metadata like gas info, deposited tokens, callvalue, and expiration time.

- If the ticket already exists, its metadata is updated — but the Status field is preserved unless it's still `Untriaged` or blank.

This prevents overwriting any manual updates (e.g., `Investigating` or `Resolved`).
This enables teams to track and resolve at-risk retryables without losing triage state between runs.

### Slack Alerts (when `--enableAlerting` is also used)

Slack alerts are sent only for tickets that:

- Are marked as `Untriaged` or `Investigating`,

- Have less than 2 days left before expiration.

- Are not already marked as `Resolved` or `Expired`

- Successfully redeemed tickets are skipped, keeping the database focused on retryables that are stuck, failed, or at risk.

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
