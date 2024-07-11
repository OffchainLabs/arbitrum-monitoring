# Arbitrum Monitoring

## Overview

Arbitrum Monitoring is a monorepo containing a collection of scripts designed to monitor various aspects of the Arbitrum network. Each folder/package within the `packages` folder in this repository focuses on specific monitoring tasks, like monitoring retryables, batch posting, etc.

## Installation

Ensure you are using Node v18 or greater.

```bash
yarn install
```

## Running Monitoring Scripts

To start monitoring different aspects of Arbitrum, navigate to the relevant package folder inside `packages`, and run the desired scripts. Detailed instructions for each script can be found within their respective folders.

### Example

```bash
yarn workspace retryable-monitor dev
```

This can also be accessed simply from the root-level in this repository by:

```bash
yarn retryable-monitor
```
