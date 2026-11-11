import { describe, expect, it } from 'vitest'
import { OnsetDetector, type Onset } from './onsetDetector'

const SR = 48000

/** Deterministic pseudo-random noise so tests are reproducible. */
function rng(seed = 1) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32 - 0.5
  }
}

function makeSignal(seconds: number, fill: (i: number, t: number) => number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  for (let i = 0; i < out.length; i++) out[i] = fill(i, i / SR)
  return out
}

/** Feed in 128-sample render quanta, as an AudioWorklet would. */
function run(det: OnsetDetector, signal: Float32Array): Onset[] {
  const onsets: Onset[] = []
  for (let i = 0; i < signal.length; i += 128) onsets.push(...det.process(signal.subarray(i, i + 128)))
  return onsets
}

/** Quiet room noise with decaying noise bursts (clap-like) at the given times. */
function claps(times: number[], seconds = 2, amp = 0.5) {
  const noise = rng()
  return makeSignal(seconds, (_, t) => {
    let x = noise() * 0.002
    for (const c of times) {
      if (t >= c && t < c + 0.08) x += noise() * amp * Math.exp(-(t - c) / 0.015)
    }
    return x
  })
}

describe('OnsetDetector', () => {
  it('stays quiet on background noise', () => {
    const noise = rng()
    const onsets = run(new OnsetDetector({ sampleRate: SR }), makeSignal(2, () => noise() * 0.002))
    expect(onsets).toEqual([])
  })

  it('detects a clap close to where it starts', () => {
    const [onset, ...rest] = run(new OnsetDetector({ sampleRate: SR }), claps([1.0]))
    expect(rest).toEqual([])
    expect(onset.sampleIndex / SR).toBeGreaterThanOrEqual(1.0)
    expect(onset.sampleIndex / SR).toBeLessThan(1.005)
    expect(onset.levelDb).toBeGreaterThan(-20)
    expect(onset.brightness).toBeGreaterThan(0.5)
  })

  it('detects separate claps but only once each', () => {
    const onsets = run(new OnsetDetector({ sampleRate: SR }), claps([0.5, 0.9, 1.4]))
    expect(onsets.map((o) => Math.round((o.sampleIndex / SR) * 10) / 10)).toEqual([0.5, 0.9, 1.4])
  })

  it('ignores sounds during warmup', () => {
    expect(run(new OnsetDetector({ sampleRate: SR }), claps([0.1]))).toEqual([])
  })

  it('louder claps report a higher level', () => {
    const [soft] = run(new OnsetDetector({ sampleRate: SR }), claps([1.0], 2, 0.1))
    const [loud] = run(new OnsetDetector({ sampleRate: SR }), claps([1.0], 2, 0.8))
    expect(loud.levelDb).toBeGreaterThan(soft.levelDb + 10)
  })

  it('reports a sustained low tone as dull and fires at most once', () => {
    const noise = rng()
    const signal = makeSignal(3, (_, t) => noise() * 0.002 + (t > 1 ? 0.5 * Math.sin(2 * Math.PI * 150 * t) : 0))
    const onsets = run(new OnsetDetector({ sampleRate: SR, minLevelDb: -70 }), signal)
    expect(onsets.length).toBeLessThanOrEqual(1)
    for (const o of onsets) expect(o.brightness).toBeLessThan(0.1)
  })

  it('respects a higher threshold', () => {
    const det = new OnsetDetector({ sampleRate: SR, thresholdDb: 80 })
    expect(run(det, claps([1.0]))).toEqual([])
  })
})
