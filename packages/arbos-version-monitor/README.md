# ArbOS Version Monitor

Checks that every monitored chain runs at least a minimum ArbOS version.

## How it works

For each chain in `config.json`, the monitor calls `ArbSys.arbOSVersion()` on the ArbSys precompile (`0x...0064`) via `orbitRpcUrl`. The returned value minus 55 is the actual ArbOS version (the offset is kept for compatibility with Arbitrum classic).

- Version below the minimum → alert.
- RPC unavailable or returning an invalid value → alert, since the chain cannot be monitored.

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
