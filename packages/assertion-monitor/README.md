# Assertion Monitor

This tool is designed to monitor assertions on Arbitrum chains. It performs comprehensive monitoring of both BOLD (Bounded Liquidity Delay) and Classic rollup chains, with the following checks:

## Chain Activity Monitoring
1. Tracks chain activity by monitoring block progression
2. Verifies the latest confirmed block number from the child chain
3. Detects periods of inactivity or stalled chain progress

## Assertion Creation Monitoring
1. No assertions created in the last 4 hours when there is chain activity
2. Tracks creation events and validates their frequency
3. Alerts when chain activity exists without new assertions

## Assertion Confirmation Monitoring
1. No assertions confirmed within the chain's confirmation period
2. Tracks unconfirmed assertions and their age
3. Monitors confirmation delays against the chain's configured period
4. Validates the time between creation and confirmation events

## Alert Types
The monitor generates alerts for the following conditions:

1. Creation Issues:
   - No assertion creation events in the last 7 days
   - Chain activity detected but no new assertions created in the last 4 hours

2. Confirmation Issues:
   - Parent chain confirmation issues - assertions not confirming
   - Unconfirmed assertions present
   - Assertion age exceeds confirmation period
   - Confirmation delay exceeds the configured period

3. Chain State Issues:
   - Chain stalled or inactive
   - Block synchronization issues
   - Validator whitelist status changes

Read more about assertions [here](https://docs.arbitrum.io/how-arbitrum-works/inside-arbitrum-nitro#arbitrum-rollup-protocol).

## Prerequisites

Before using this tool, make sure you have the following installed:

- [Node.js](https://nodejs.org/en)
- [Yarn](https://classic.yarnpkg.com/lang/en/docs/install/#mac-stable)

Additionally, ensure that you have added your Arbitrum network configuration to the `config.json` file in the `lib` directory;

## Installation

From the root directory of the project, run the following command to install dependencies:

```bash
yarn install
```

## Execution

### One-off Check

To find assertion events and display their status for a specific block range, execute the following command:

```bash
yarn dev [--configPath=<CONFIG_PATH>]
```

- If `--configPath` is not provided, it defaults to `config.json`.
- This command will identify all assertion events (both creation and confirmation) from the parent chain to your Orbit chain within the specified block range.

### Error Generation and Reporting

To enable reporting, use `--enableAlerting` flag.

This will enable alerts for all the conditions listed above in the Alert Types section.

Additionally, you might also want to log these errors to Slack, for which you will need to configure, in the `.env` file:

- `NODE_ENV=CI`
- `ASSERTION_MONITORING_SLACK_TOKEN=<your-slack-token>`
- `ASSERTION_MONITORING_SLACK_CHANNEL=<your-slack-channel-key>`

Check [Slack integration documentation](https://api.slack.com/quickstart) for more information about getting these auth tokens.

## Chain Support

The monitor automatically detects and adapts to different chain types:

1. BOLD (Bounded Liquidity Delay) Chains:
   - Uses BOLD-specific assertion formats and validation
   - Tracks BOLD-specific confirmation processes
   - Monitors BOLD genesis assertion hash

2. Classic Rollup Chains:
   - Uses Classic node creation and confirmation events
   - Monitors Classic-specific block validation
   - Tracks node confirmation processes
