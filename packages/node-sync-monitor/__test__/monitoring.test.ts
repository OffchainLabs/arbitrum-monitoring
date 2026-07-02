import { describe, expect, it } from 'vitest'
import { evaluateNodeSync } from '../monitoring'

const baseInput = {
  syncStatus: false as const,
  blockLagThreshold: 100,
}

describe('evaluateNodeSync', () => {
  it('passes when the node is synced and within the lag threshold', () => {
    const result = evaluateNodeSync({
      ...baseInput,
      nodeBlock: 1000n,
      referenceBlock: 1050n,
    })
    expect(result).toEqual({ kind: 'ok', lag: 50 })
  })

  it('passes on a quiet chain where node and reference heads are equal', () => {
    const result = evaluateNodeSync({
      ...baseInput,
      nodeBlock: 1000n,
      referenceBlock: 1000n,
    })
    expect(result).toEqual({ kind: 'ok', lag: 0 })
  })

  it('passes when the node is slightly ahead of a lagging reference', () => {
    const result = evaluateNodeSync({
      ...baseInput,
      nodeBlock: 1010n,
      referenceBlock: 1000n,
    })
    expect(result).toEqual({ kind: 'ok', lag: 0 })
  })

  it('alerts when the node trails the reference beyond the threshold', () => {
    const result = evaluateNodeSync({
      ...baseInput,
      nodeBlock: 1000n,
      referenceBlock: 1101n,
    })
    expect(result.kind).toBe('alert')
    expect(result.kind === 'alert' && result.message).toContain('101 blocks')
  })

  it('alerts when the node reports it is still syncing', () => {
    const result = evaluateNodeSync({
      ...baseInput,
      syncStatus: { currentBlock: '0x1' },
      nodeBlock: 1000n,
      referenceBlock: 1000n,
    })
    expect(result.kind).toBe('alert')
    expect(result.kind === 'alert' && result.message).toContain('syncing')
  })

  it('alerts when the node RPC is unreachable', () => {
    const result = evaluateNodeSync({
      ...baseInput,
      syncStatus: null,
      nodeBlock: null,
      referenceBlock: 1000n,
    })
    expect(result.kind).toBe('alert')
    expect(result.kind === 'alert' && result.message).toContain('unreachable')
  })

  it('alerts as unverifiable when the reference RPC is unreachable', () => {
    const result = evaluateNodeSync({
      ...baseInput,
      nodeBlock: 1000n,
      referenceBlock: null,
    })
    expect(result.kind).toBe('alert')
    expect(result.kind === 'alert' && result.message).toContain(
      'Unable to verify'
    )
  })
})
