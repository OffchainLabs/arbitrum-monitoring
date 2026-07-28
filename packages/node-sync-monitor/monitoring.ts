export type NodeSyncCheckInput = {
  /** eth_syncing from the operator's node: false when synced, an object while syncing, null if the call failed. */
  syncStatus: false | Record<string, unknown> | null
  /** eth_blockNumber from the operator's node, or null if the RPC was unreachable. */
  nodeBlock: bigint | null
  /** eth_blockNumber from the trusted reference RPC, or null if it was unreachable. */
  referenceBlock: bigint | null
  /** Maximum blocks the node may trail the reference before alerting. */
  blockLagThreshold: number
}

export type NodeSyncCheckResult =
  | { kind: 'ok'; lag: number }
  | { kind: 'alert'; message: string }

/**
 * Decides whether a node is healthy. A node is healthy when it reports
 * synced (eth_syncing === false) and its head is within blockLagThreshold
 * of the trusted reference RPC.
 *
 * Comparing heights against a reference (rather than requiring the head to
 * advance) also handles quiet chains correctly: Arbitrum chains produce
 * blocks on demand, so on an idle chain both heads simply stay equal.
 */
export const evaluateNodeSync = ({
  syncStatus,
  nodeBlock,
  referenceBlock,
  blockLagThreshold,
}: NodeSyncCheckInput): NodeSyncCheckResult => {
  if (nodeBlock === null) {
    return { kind: 'alert', message: 'Node RPC is unreachable.' }
  }

  if (syncStatus === null) {
    return {
      kind: 'alert',
      message: 'Unable to read eth_syncing from the node.',
    }
  }

  if (syncStatus !== false) {
    return {
      kind: 'alert',
      message: `Node reports it is still syncing: ${JSON.stringify(
        syncStatus
      )}`,
    }
  }

  if (referenceBlock === null) {
    return {
      kind: 'alert',
      message: `Unable to verify sync state: reference RPC is unreachable (node is at block ${nodeBlock}).`,
    }
  }

  // A node slightly ahead of a lagging reference is healthy; clamp at 0.
  const lag = Math.max(0, Number(referenceBlock - nodeBlock))

  if (lag > blockLagThreshold) {
    return {
      kind: 'alert',
      message: `Node is ${lag} blocks behind the reference RPC (node: ${nodeBlock}, reference: ${referenceBlock}, threshold: ${blockLagThreshold}).`,
    }
  }

  return { kind: 'ok', lag }
}
