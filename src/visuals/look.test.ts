import { describe, expect, it } from 'vitest'
import { matchPreset, PRESETS, trailDecay } from './look'

describe('matchPreset', () => {
  it('recognizes every preset', () => {
    for (const [name, look] of Object.entries(PRESETS)) expect(matchPreset({ ...look })).toBe(name)
  })

  it('reports custom once any value moves', () => {
    expect(matchPreset({ ...PRESETS.neon, glow: 0.55 })).toBe('custom')
    expect(matchPreset({ ...PRESETS.party, shake: false })).toBe('custom')
  })

  it('presets are all distinct', () => {
    const keys = Object.values(PRESETS).map((p) => JSON.stringify(p))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('trailDecay', () => {
  it('is 0 with trails off and always below 1 so trails fade', () => {
    expect(trailDecay(0)).toBe(0)
    expect(trailDecay(1)).toBeLessThan(1)
    expect(trailDecay(5)).toBeLessThan(1)
    expect(trailDecay(0.5)).toBeGreaterThan(trailDecay(0.2))
  })
})
