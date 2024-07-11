# Arbitrum Monitoring

## Overview

This is a monorepo containing a collection of scripts designed for monitoring various aspects of Arbitrum chains. Each package focuses on one particular monitoring task, like monitoring retryables, batch posting, etc.

## Installation

Ensure you are using Node v18 or greater.

```bash
yarn install
```

## Running Monitoring Scripts

To run a monitoring tool, navigate to the relevant package folder inside `packages`, and run the desired scripts. Detailed instructions for each script can be found within their respective folders.

### Example

```bash
yarn workspace retryable-monitor dev [--options]
```

This can also be accessed simply from the root-level in this repository by:

```bash
yarn retryable-monitor [--options]
```
