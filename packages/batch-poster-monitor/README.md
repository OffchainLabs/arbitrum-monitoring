# Batch Poster Monitor

The Batch Poster Monitor is a package that allows you to monitor the progress of batch poster jobs in real-time. It provides a simple and intuitive interface to track the status of your batch poster jobs and view detailed information about each job.

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

## Usage

To use the Batch Poster Monitor package, follow these steps:

```bash
yarn dev [--configPath=<CONFIG_PATH>] --enableAlerting
```

## Configuration Options

The Batch Poster Monitor accepts an array of chain configurations with the following parameters:

```typescript
      "name": string // Name of the chain being monitored
      "chainId": number // ChainId of the chain being monitored
      "parentChainId": number // ChainId of the chain's parent
      "rpc": string // RPC URL of the chain being monitored
      "rollup": string // Rollup address of the chain being monitored
      "sequencerInbox": string //  Sequencer Inbox address of the chain being monitored
      "bridge": string // Bridge address of the chain being monitored

```

### Error Generation and Reporting

To enable reporting, use `--enableAlerting` flag.

This will enable alerts if a batch-poster monitoring detects any anomalies. Additionally, you might also want to log these errors to Slack, for which you will need to configure, in the `.env` file:

- `NODE_ENV=CI`
- `BATCH_POSTER_MONITORING_SLACK_TOKEN=<your-slack-token>`
- `BATCH_POSTER_MONITORING_SLACK_CHANNEL=<your-slack-channel-key>`

Check [Slack integration documentation](https://api.slack.com/quickstart) for more information about getting these auth tokens.
