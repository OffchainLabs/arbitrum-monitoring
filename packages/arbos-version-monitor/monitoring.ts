export type ArbosVersionCheckInput = {
  /** ArbOS version reported by the child chain, or null if the RPC was unavailable or returned an invalid value. */
  arbosVersion: number | null
  minimumArbosVersion: number
}

export type ArbosVersionCheckResult =
  | { kind: 'ok'; version: number }
  | { kind: 'alert'; message: string }

/**
 * Decides whether a chain runs an outdated ArbOS version, based on
 * ArbSys.arbOSVersion() reported by the child chain RPC. An unavailable
 * version is itself an alert: the chain cannot be monitored.
 */
export const evaluateArbosVersion = ({
  arbosVersion,
  minimumArbosVersion,
}: ArbosVersionCheckInput): ArbosVersionCheckResult => {
  if (arbosVersion === null) {
    return {
      kind: 'alert',
      message: `Unable to determine ArbOS version: child chain RPC is unavailable or returned an invalid value.`,
    }
  }

  if (arbosVersion < minimumArbosVersion) {
    return {
      kind: 'alert',
      message: `Chain is running ArbOS ${arbosVersion}, below the minimum expected version ${minimumArbosVersion}.`,
    }
  }

  return { kind: 'ok', version: arbosVersion }
}
