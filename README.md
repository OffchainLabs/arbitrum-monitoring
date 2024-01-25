# Orbit-retryables-tracker

This tool is designed to assist in identifying and displaying the status of retryable tickets sent from a parent chain (any of the Arbitrum chains) to the Orbit chain. Read more about retryable tickets [here](https://docs.arbitrum.io/arbos/l1-to-l2-messaging).

## Prerequisites

Before using this tool, make sure you have the following installed:

- [Node.js](https://nodejs.org/en)
- [Yarn](https://classic.yarnpkg.com/lang/en/docs/install/#mac-stable)

Additionally, ensure that you have added your L3 network configuration to the `config.json` file in the `lib` directory; the `xai` mainnet network is included as an example.

## Installation

From the root directory of the project, run the following command to install dependencies:

```bash
yarn install
```

## Execution

### One-off Check

To find retryable tickets and display their status for a specific block range, execute the following command:

```bash
yarn findRetryables --fromBlock=<FROM_BLOCK> --toBlock=<TO_BLOCK> [--configPath=<CONFIG_PATH>]
```

Replace <FROM_BLOCK>, <TO_BLOCK>, and <CONFIG_PATH> with the desired block numbers and the path to your configuration file. If `--configPath` is not provided, it defaults to `config.json`. This command will identify all retryable tickets initiated or created from the parent chain to your Orbit chain within the specified block range.

### Continuous Update

To continuously monitor and update the status of retryable tickets, execute the following command:

```bash
yarn findRetryables --continuous [--configPath=<CONFIG_PATH>]
```

Replace `<CONFIG_PATH>` with the path to your configuration file. If `--configPath` is not provided, it defaults to `config.json`. This command will initiate continuous monitoring, dynamically determining the block range based on the latest block on the parent chain. The tool will automatically fetch and display the status of retryable tickets at regular intervals.
