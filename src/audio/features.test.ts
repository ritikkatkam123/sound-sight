import { describe, expect, it } from 'vitest'
import { estimatePitch, levelDb, logBands, spectralCentroid, waveShape } from './features'

const SR = 48000
const N = 2048

const sine = (hz: number, amp = 0.5) => Float32Array.from({ length: N }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR))

function noise(seed = 3) {
  let s = seed
  return Float32Array.from({ length: N }, () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return (s / 2 ** 32 - 0.5) * 0.5
  })
}

describe('levelDb', () => {
  it('measures a full-scale sine at about -3 dBFS', () => {
    expect(levelDb(sine(440, 1))).toBeCloseTo(-3, 0)
  })

  it('floors silence at -100', () => {
    expect(levelDb(new Float32Array(N))).toBe(-100)
  })
})

describe('estimatePitch', () => {
  it.each([150, 440, 1200])('finds a %i Hz tone within 2%%', (hz) => {
    expect(estimatePitch(sine(hz), SR)).toBeGreaterThan(hz * 0.98)
    expect(estimatePitch(sine(hz), SR)).toBeLessThan(hz * 1.02)
  })

  it('finds the fundamental of a tone with a strong overtone, not the overtone', () => {
    const buf = sine(220)
    const over = sine(440, 0.4)
    for (let i = 0; i < N; i++) buf[i] += over[i]
    expect(estimatePitch(buf, SR)).toBeCloseTo(220, -1)
  })

  it('returns null for noise and silence', () => {
    expect(estimatePitch(noise(), SR)).toBeNull()
    expect(estimatePitch(new Float32Array(N), SR)).toBeNull()
  })
})

describe('spectralCentroid', () => {
  it('sits at the frequency of a single peak', () => {
    const bins = 1024
    const spectrum = new Float32Array(bins).fill(-200)
    const binHz = SR / 2 / bins
    spectrum[Math.round(3000 / binHz)] = 0
    expect(spectralCentroid(spectrum, SR)).toBeCloseTo(3000, -2)
  })

  it('is higher for brighter spectra', () => {
    const dull = new Float32Array(1024).map((_, i) => -i * 0.2)
    const bright = new Float32Array(1024).map((_, i) => -60 + i * 0.05)
    expect(spectralCentroid(bright, SR)).toBeGreaterThan(spectralCentroid(dull, SR))
  })
})

describe('waveShape', () => {
  it('normalizes to a peak of 1 and starts at a rising zero crossing', () => {
    const shape = waveShape(sine(440, 0.2), 64, 512)
    expect(shape).toHaveLength(64)
    expect(Math.max(...shape.map(Math.abs))).toBeCloseTo(1)
    expect(Math.abs(shape[0])).toBeLessThan(0.1)
    expect(shape[1]).toBeGreaterThan(shape[0])
  })

  it('returns zeros for silence', () => {
    expect([...waveShape(new Float32Array(N))].every((v) => v === 0)).toBe(true)
  })
})

describe('logBands', () => {
  it('lights up only the band containing a tone', () => {
    const bins = 1024
    const spectrum = new Float32Array(bins).fill(-120)
    spectrum[Math.round(1000 / (SR / 2 / bins))] = -25
    const bands = logBands(spectrum, SR, 32)
    const lit = [...bands].map((v, i) => [v, i]).filter(([v]) => v > 0.5)
    expect(lit).toHaveLength(1)
    // 1 kHz sits a little past the middle of a 60 Hz–12 kHz log scale.
    expect(lit[0][1]).toBeGreaterThan(14)
    expect(lit[0][1]).toBeLessThan(20)
  })

  it('clamps to 0..1', () => {
    const bands = logBands(new Float32Array(1024).fill(0), SR, 8)
    expect([...bands].every((v) => v === 1)).toBe(true)
  })
})
