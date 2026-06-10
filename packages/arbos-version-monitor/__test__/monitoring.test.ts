import { describe, expect, it } from 'vitest'
import { evaluateArbosVersion } from '../monitoring'

const CONSENSUS_V32_ROOT =
  '0x184884e1eb9fefdc158f6c8ac912bb183bf3cf83f0090317e0bc4ac5860baa39'
const CONSENSUS_V40_ROOT =
  '0xdb698a2576298f25448bc092e52cf13b1e24141c997135d70f217d674bbeb69a'
const UNKNOWN_ROOT =
  '0x1111111111111111111111111111111111111111111111111111111111111111'

const baseInput = {
  chainName: 'Test Chain',
  minimumArbosVersion: 40,
}

describe('evaluateArbosVersion', () => {
  it('alerts when ArbSys reports a version below the minimum', () => {
    const result = evaluateArbosVersion({
      ...baseInput,
      arbosVersion: 32,
      wasmModuleRoot: CONSENSUS_V32_ROOT,
    })
    expect(result.kind).toBe('alert')
    expect(result.kind === 'alert' && result.message).toContain('ArbOS 32')
    expect(result.kind === 'alert' && result.message).toContain('40')
  })

  it('passes when ArbSys reports a version meeting the minimum', () => {
    const result = evaluateArbosVersion({
      ...baseInput,
      arbosVersion: 40,
      wasmModuleRoot: CONSENSUS_V40_ROOT,
    })
    expect(result).toEqual({ kind: 'ok', source: 'arbsys', version: 40 })
  })

  it('prefers the ArbSys version over the wasmModuleRoot when both are available', () => {
    // root says v32 but the chain itself reports 41 — ArbSys wins
    const result = evaluateArbosVersion({
      ...baseInput,
      arbosVersion: 41,
      wasmModuleRoot: CONSENSUS_V32_ROOT,
    })
    expect(result).toEqual({ kind: 'ok', source: 'arbsys', version: 41 })
  })

  it('falls back to the wasmModuleRoot and alerts on an outdated consensus release', () => {
    const result = evaluateArbosVersion({
      ...baseInput,
      arbosVersion: null,
      wasmModuleRoot: CONSENSUS_V32_ROOT,
    })
    expect(result.kind).toBe('alert')
    expect(result.kind === 'alert' && result.message).toContain('consensus-v32')
    expect(result.kind === 'alert' && result.message).toContain(
      'wasmModuleRoot'
    )
  })

  it('falls back to the wasmModuleRoot and passes on a current consensus release', () => {
    const result = evaluateArbosVersion({
      ...baseInput,
      arbosVersion: null,
      wasmModuleRoot: CONSENSUS_V40_ROOT,
    })
    expect(result).toEqual({
      kind: 'ok',
      source: 'wasmModuleRoot',
      version: 40,
    })
  })

  it('matches wasmModuleRoots case-insensitively', () => {
    const result = evaluateArbosVersion({
      ...baseInput,
      arbosVersion: null,
      wasmModuleRoot: CONSENSUS_V40_ROOT.toUpperCase().replace('0X', '0x'),
    })
    expect(result.kind).toBe('ok')
  })

  it('skips when the wasmModuleRoot is unknown', () => {
    const result = evaluateArbosVersion({
      ...baseInput,
      arbosVersion: null,
      wasmModuleRoot: UNKNOWN_ROOT,
    })
    expect(result.kind).toBe('skip')
    expect(result.kind === 'skip' && result.reason).toContain('Test Chain')
  })

  it('alerts when both data sources are unavailable', () => {
    const result = evaluateArbosVersion({
      ...baseInput,
      arbosVersion: null,
      wasmModuleRoot: null,
    })
    expect(result.kind).toBe('alert')
    expect(result.kind === 'alert' && result.message).toContain(
      'Unable to determine'
    )
  })
})
