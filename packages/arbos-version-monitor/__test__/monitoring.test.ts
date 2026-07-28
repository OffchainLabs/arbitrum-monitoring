import { describe, expect, it } from 'vitest'
import { evaluateArbosVersion } from '../monitoring'

describe('evaluateArbosVersion', () => {
  it('alerts when the chain reports a version below the minimum', () => {
    const result = evaluateArbosVersion({
      arbosVersion: 32,
      minimumArbosVersion: 40,
    })
    expect(result.kind).toBe('alert')
    expect(result.kind === 'alert' && result.message).toContain('ArbOS 32')
    expect(result.kind === 'alert' && result.message).toContain('40')
  })

  it('passes when the chain reports a version equal to the minimum', () => {
    const result = evaluateArbosVersion({
      arbosVersion: 40,
      minimumArbosVersion: 40,
    })
    expect(result).toEqual({ kind: 'ok', version: 40 })
  })

  it('passes when the chain reports a version above the minimum', () => {
    const result = evaluateArbosVersion({
      arbosVersion: 41,
      minimumArbosVersion: 40,
    })
    expect(result).toEqual({ kind: 'ok', version: 41 })
  })

  it('alerts when the version could not be determined', () => {
    const result = evaluateArbosVersion({
      arbosVersion: null,
      minimumArbosVersion: 40,
    })
    expect(result.kind).toBe('alert')
    expect(result.kind === 'alert' && result.message).toContain(
      'Unable to determine'
    )
  })
})
