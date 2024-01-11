# Orbit-retrybles-tracker

This tool is designed to assist in identifying and displaying the status of retryable tickets sent from a parent chain (any of the Arbitrum chains) to the Orbit chain.

## Prerequisites

Before using this tool, make sure you have the following installed:

- [Node.js](https://nodejs.org/en)
- [Yarn](https://classic.yarnpkg.com/lang/en/docs/install/#mac-stable)

Additionally, ensure that you have added your Orbit chain configuration to the `networks.ts` file to enable adding it as a custom chain to the Arbitrum SDK.

## Configuration

Set the necessary env variables by copying the values from `.env-sample` into a new `.env` file. You can do this with the following command:

```bash
cp .env-sample .env

```

Fill in the required values in the .env file with your specific configuration.

## Installation

From the root directory of the project, run the following command to install dependencies:

```bash
yarn install
```

## Execution

To find retryable tickets and display their status, execute the following command:

```bash
yarn findRetryables
```

This command will identify all retryable tickets initiated or created from the parent chain to your Orbit chain within the specified block range (from `fromBlock` to `toBlock`), as configured in the .env file.
