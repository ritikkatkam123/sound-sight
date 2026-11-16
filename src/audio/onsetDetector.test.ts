import { describe, expect, it } from 'vitest'
import { isKick, OnsetDetector, type Onset, type Tone } from './onsetDetector'

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

  it('keeps up with beatbox-speed hits (8 a second)', () => {
    const times = Array.from({ length: 8 }, (_, i) => 0.5 + i * 0.125)
    const onsets = run(new OnsetDetector({ sampleRate: SR }), claps(times, 2))
    expect(onsets.length).toBe(8)
  })
})

describe('bass measurement', () => {
  /** Feeds a signal and returns the bass Tone for each onset. */
  function tones(signal: Float32Array): { onsets: Onset[]; tones: Tone[] } {
    const det = new OnsetDetector({ sampleRate: SR })
    const onsets: Onset[] = []
    const out: Tone[] = []
    for (let i = 0; i < signal.length; i += 128) {
      onsets.push(...det.process(signal.subarray(i, i + 128)))
      out.push(...det.takeTones())
    }
    return { onsets, tones: out }
  }

  /** A beatboxed "b" kick: a sharp lip click, then a low decaying thump. */
  const kick = () => {
    const noise = rng(7)
    return makeSignal(1.5, (_, t) => {
      let x = noise() * 0.002
      const dt = t - 1
      if (dt >= 0 && dt < 0.004) x += noise() * 0.9
      if (dt >= 0.002 && dt < 0.25) x += 0.5 * Math.sin(2 * Math.PI * 90 * dt) * Math.exp(-dt / 0.06)
      return x
    })
  }

  /** A hi-hat "ts": a short burst of hiss. */
  const hat = () => {
    const noise = rng(3)
    return makeSignal(1.5, (_, t) => {
      let x = noise() * 0.002
      const dt = t - 1
      if (dt >= 0 && dt < 0.06) x += noise() * 0.5 * Math.exp(-dt / 0.012)
      return x
    })
  }

  it('reports one tone per onset, for the same sample', () => {
    const { onsets, tones: t } = tones(kick())
    expect(onsets).toHaveLength(1)
    expect(t).toHaveLength(1)
    expect(t[0].sampleIndex).toBe(onsets[0].sampleIndex)
  })

  it('tells a beatboxed kick from a hi-hat, even though both start with a sharp attack', () => {
    const k = tones(kick())
    const h = tones(hat())
    expect(isKick({ ...k.onsets[0], bass: k.tones[0].bass })).toBe(true)
    expect(isKick({ ...h.onsets[0], bass: h.tones[0].bass })).toBe(false)
    expect(k.tones[0].bass).toBeGreaterThan(h.tones[0].bass * 5)
  })

  it('falls back to the attack before the bass is known', () => {
    expect(isKick({ brightness: 0.1 })).toBe(true)
    expect(isKick({ brightness: 0.9 })).toBe(false)
  })
})
