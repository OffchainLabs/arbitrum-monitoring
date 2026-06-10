# ArbOS Version Monitor

Checks that every monitored chain runs at least a minimum ArbOS version.

## How it works

For each chain in `config.json`, the monitor fetches two data sources concurrently:

1. **Child chain RPC (primary)** — calls `ArbSys.arbOSVersion()` on the ArbSys precompile (`0x...0064`) via `orbitRpcUrl`. The returned value minus 55 is the actual ArbOS version.
2. **Parent chain rollup contract (fallback)** — reads `wasmModuleRoot()` from the rollup contract (resolved via the bridge, so rollup upgrades are handled) via `parentRpcUrl`.

Decision flow:

- If the child chain RPC returns a valid version, it is compared against the minimum. Below minimum → alert.
- If the child chain RPC is unavailable or returns an invalid value, the version is inferred from the `wasmModuleRoot` using a static table of known consensus releases ([wasmModuleRoots.ts](./wasmModuleRoots.ts), sourced from [nitro releases](https://github.com/OffchainLabs/nitro/releases)). Below minimum → alert, with a note that the value is inferred (it reflects the node software's supported version, not necessarily the chain's activated version).
- If the root is not a known consensus release (e.g. a custom machine), the chain is skipped.
- If both sources are unavailable, an alert is raised since the chain cannot be monitored.

## Usage

```bash
yarn arbos-version-monitor [options]
```

Options:

- `--configPath`: Path to configuration file (default: "config.json")
- `--enableAlerting`: Enable Slack alerts (default: false)
- `--minimumArbosVersion`: Minimum acceptable ArbOS version (default: 40)

Environment variables for alerting:

```bash
ARBOS_VERSION_MONITORING_SLACK_TOKEN=your-slack-token
ARBOS_VERSION_MONITORING_SLACK_CHANNEL=your-slack-channel
```

## Maintenance

When a new nitro consensus release is published, add its WASM module root to [wasmModuleRoots.ts](./wasmModuleRoots.ts). Roots are listed in the release notes of tags prefixed `consensus-` in the nitro repository.
