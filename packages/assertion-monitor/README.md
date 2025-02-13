# Assertion Monitor

This tool is designed to monitor assertions on Arbitrum chains. It checks for:
1. Chains that have not posted any assertions in the last seven days
2. Chains with low assertion confirmation rates (below 80%)

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

To monitor assertions and display their status for a specific block range, execute the following command:

```bash
yarn dev [--configPath=<CONFIG_PATH>]
```

- If `--configPath` is not provided, it defaults to `config.json`.
- This command will identify all assertion events (both creation and confirmation) from the parent chain to your Orbit chain within the specified block range.

### Error Generation and Reporting

To enable reporting, use `--enableAlerting` flag.

This will enable alerts if:
1. There have not been any assertions in the past week
2. The assertion confirmation rate is below 80%

Additionally, you might also want to log these errors to Slack, for which you will need to configure, in the `.env` file:

- `NODE_ENV=CI`
- `ASSERTION_MONITORING_SLACK_TOKEN=<your-slack-token>`
- `ASSERTION_MONITORING_SLACK_CHANNEL=<your-slack-channel-key>`

Check [Slack integration documentation](https://api.slack.com/quickstart) for more information about getting these auth tokens.
