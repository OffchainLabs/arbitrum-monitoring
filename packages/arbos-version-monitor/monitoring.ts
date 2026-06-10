import { getWasmModuleRootInfo } from './wasmModuleRoots'

export type ArbosVersionCheckInput = {
  chainName: string
  /** ArbOS version reported by the child chain, or null if the RPC was unavailable or returned an invalid value. */
  arbosVersion: number | null
  /** wasmModuleRoot read from the rollup contract on the parent chain, or null if it could not be read. */
  wasmModuleRoot: string | null
  minimumArbosVersion: number
}

export type ArbosVersionCheckResult =
  | { kind: 'ok'; source: 'arbsys' | 'wasmModuleRoot'; version: number }
  | { kind: 'alert'; message: string }
  | { kind: 'skip'; reason: string }

/**
 * Decides whether a chain runs an outdated ArbOS version.
 *
 * Primary source is ArbSys.arbOSVersion() from the child chain RPC. If that
 * is unavailable, falls back to inferring the version from the rollup's
 * wasmModuleRoot on the parent chain. Unknown roots are skipped.
 */
export const evaluateArbosVersion = ({
  chainName,
  arbosVersion,
  wasmModuleRoot,
  minimumArbosVersion,
}: ArbosVersionCheckInput): ArbosVersionCheckResult => {
  if (arbosVersion !== null) {
    if (arbosVersion < minimumArbosVersion) {
      return {
        kind: 'alert',
        message: `Chain is running ArbOS ${arbosVersion}, below the minimum expected version ${minimumArbosVersion}.`,
      }
    }
    return { kind: 'ok', source: 'arbsys', version: arbosVersion }
  }

  if (wasmModuleRoot === null) {
    return {
      kind: 'alert',
      message: `Unable to determine ArbOS version: child chain RPC is unavailable and wasmModuleRoot could not be read from the rollup contract.`,
    }
  }

  const rootInfo = getWasmModuleRootInfo(wasmModuleRoot)
  if (!rootInfo) {
    return {
      kind: 'skip',
      reason: `[${chainName}] Child chain RPC unavailable and wasmModuleRoot ${wasmModuleRoot} is not a known consensus release (custom machine?), skipping.`,
    }
  }

  if (rootInfo.maxArbosVersion < minimumArbosVersion) {
    return {
      kind: 'alert',
      message: `Child chain RPC is unavailable; inferred from wasmModuleRoot (${rootInfo.consensusRelease}) that the node supports at most ArbOS ${rootInfo.maxArbosVersion}, below the minimum expected version ${minimumArbosVersion}.`,
    }
  }

  return {
    kind: 'ok',
    source: 'wasmModuleRoot',
    version: rootInfo.maxArbosVersion,
  }
}
