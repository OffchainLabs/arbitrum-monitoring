# Node Sync Monitor

Checks that an operator-run Arbitrum node is healthy by comparing it against a trusted reference RPC for the same chain. A node is considered healthy when:

1. it reports synced (`eth_syncing` returns `false`), and
2. its head is within `--blockLagThreshold` blocks (default 100) of the reference RPC.

Comparing heights against a reference also handles quiet chains correctly: Arbitrum chains produce blocks on demand, so a node that is "stuck" is indistinguishable from an idle chain by looking at its own head alone — but against a reference, a stuck node shows growing lag while an idle chain stays equal.

## Configuration

Add `monitoredNodeRpcUrl` (the RPC endpoint of your own node) and `referenceRpcUrl` (a trusted RPC for the same chain to compare against) to a chain entry in `config.json`. Chains without `monitoredNodeRpcUrl` are skipped; setting only one of the two fields raises an alert.

```json
{
  "name": "Arbitrum One",
  "monitoredNodeRpcUrl": "http://localhost:8547",
  "referenceRpcUrl": "https://arb1.arbitrum.io/rpc"
}
```

> **Important:** point `referenceRpcUrl` at infrastructure independent of the monitored node (the chain's public gateway or a third-party provider). If both URLs reach the same infrastructure, the comparison cannot detect an outage.

> Note: nodes deployed with the [community Helm chart](https://github.com/OffchainLabs/community-helm-charts/tree/main/charts/nitro) serve RPC under the `/rpc` path prefix by default, e.g. `http://<host>:8547/rpc`.

## Usage

```shell
yarn node-sync-monitor [--configPath=<path>] [--enableAlerting] [--blockLagThreshold=<blocks>]
```

With `--enableAlerting`, alerts are posted to Slack using the `NODE_SYNC_MONITORING_SLACK_TOKEN` and `NODE_SYNC_MONITORING_SLACK_CHANNEL` environment variables.
