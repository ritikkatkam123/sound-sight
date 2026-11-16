// Pure onset detection, so it can run inside the AudioWorklet and in unit tests.
//
// It compares a fast (~2 ms) and a slow (~300 ms) energy envelope of the
// first-differenced signal. Differencing works as a cheap high-pass filter: claps, snaps
// and knocks are broadband transients, so they show up strongly, while hum and low voices are suppressed.
// An onset fires when the fast envelope jumps well above the slow one.
// After that we keep listening for a few ms to measure the peak level before reporting it.
// Separately, the first ~40 ms after each onset are checked for how much energy is bass, which
// tells a kick drum from a snare or hi-hat better than the attack alone (a beatboxed "b" kick
// starts with a sharp lip click, but its body is low).

export interface OnsetConfig {
  sampleRate: number
  /** How far (dB) the fast envelope must rise above the slow one. Lower means more sensitive. */
  thresholdDb?: number
  /** Ignore anything quieter than this (dBFS of the differenced signal). */
  minLevelDb?: number
  refractoryMs?: number
  /** How long after the trigger to keep measuring the peak before reporting. */
  peakWindowMs?: number
  /** How long after the trigger to measure the bass share (reported separately, as a Tone). */
  toneWindowMs?: number
  /** Cut-off of the low-pass filter that defines "bass". */
  bassHz?: number
  /** Ignore the first stretch while the envelopes settle. */
  warmupMs?: number
}

export interface Onset {
  /** Sample index (since the detector started) where the onset was triggered. */
  sampleIndex: number
  /** Peak fast-envelope level in dBFS during the peak window. */
  levelDb: number
  /** 0..1, how much of the energy is high-frequency (≈1 for clicks/claps, ≈0 for low thumps). */
  brightness: number
}

/** Measured a little after its onset: the share of the hit's energy that is bass. */
export interface Tone {
  /** sampleIndex of the onset this belongs to. */
  sampleIndex: number
  /** 0..1, ≈1 for a low thump (kick drum), ≈0 for a hiss or click (hi-hat, snare). */
  bass: number
}

/** Bass share above which a percussive hit counts as a kick drum. */
export const KICK_BASS = 0.3

/** Whether a hit sounds like a kick: by its bass share once measured, else by its (dull) attack. */
export function isKick(hit: { bass?: number; brightness: number }): boolean {
  return hit.bass !== undefined ? hit.bass >= KICK_BASS : hit.brightness < 0.45
}

const EPS = 1e-12
const toDb = (energy: number) => 10 * Math.log10(energy + EPS)

export class OnsetDetector {
  thresholdDb: number
  minLevelDb: number
  private readonly fastCoef: number
  private readonly slowCoef: number
  private readonly refractory: number
  private readonly peakWindow: number
  private readonly warmup: number
  private readonly toneWindow: number
  private readonly lowCoef: number

  private fast = 0
  private slow = 0
  private rawFast = 0
  private prev = 0
  private index = 0
  private lastOnset = -Infinity
  private low = 0
  private pending: { sampleIndex: number; peak: number; brightness: number; until: number } | null = null
  private tone: { sampleIndex: number; low: number; total: number; until: number } | null = null
  private tones: Tone[] = []

  constructor(cfg: OnsetConfig) {
    const sr = cfg.sampleRate
    this.thresholdDb = cfg.thresholdDb ?? 10
    this.minLevelDb = cfg.minLevelDb ?? -45
    this.fastCoef = Math.exp(-1 / (0.002 * sr))
    this.slowCoef = Math.exp(-1 / (0.3 * sr))
    // Fast enough for beatboxing (~10 hits a second), still one onset per clap.
    this.refractory = ((cfg.refractoryMs ?? 90) / 1000) * sr
    this.peakWindow = ((cfg.peakWindowMs ?? 12) / 1000) * sr
    this.warmup = ((cfg.warmupMs ?? 300) / 1000) * sr
    this.toneWindow = ((cfg.toneWindowMs ?? 40) / 1000) * sr
    this.lowCoef = Math.exp((-2 * Math.PI * (cfg.bassHz ?? 300)) / sr)
  }

  /** Bass measurements finished since the last call (each follows its onset by ~40 ms). */
  takeTones(): Tone[] {
    const t = this.tones
    this.tones = []
    return t
  }

  /** Total samples fed so far; sample indices in onsets are relative to this count. */
  get samplesProcessed(): number {
    return this.index
  }

  /** Feed the next block of samples; returns any onsets finalized during this block. */
  process(block: Float32Array): Onset[] {
    const out: Onset[] = []
    const fc = this.fastCoef
    const sc = this.slowCoef

    for (let i = 0; i < block.length; i++) {
      const x = block[i]
      const d = x - this.prev
      this.prev = x
      const e = d * d
      this.fast = fc * this.fast + (1 - fc) * e
      this.slow = sc * this.slow + (1 - sc) * e
      this.rawFast = fc * this.rawFast + (1 - fc) * x * x
      this.low = this.lowCoef * this.low + (1 - this.lowCoef) * x
      const n = this.index++

      if (this.tone) {
        this.tone.low += this.low * this.low
        this.tone.total += x * x
        if (n >= this.tone.until) {
          this.tones.push({ sampleIndex: this.tone.sampleIndex, bass: Math.min(1, this.tone.low / (this.tone.total + EPS)) })
          this.tone = null
        }
      }

      if (this.pending) {
        if (this.fast > this.pending.peak) {
          this.pending.peak = this.fast
          // White noise has differenced energy ≈ 2× raw energy, so normalize against that.
          this.pending.brightness = Math.min(1, this.fast / (2 * this.rawFast + EPS))
        }
        if (n >= this.pending.until) {
          out.push({
            sampleIndex: this.pending.sampleIndex,
            levelDb: toDb(this.pending.peak),
            brightness: this.pending.brightness,
          })
          this.pending = null
        }
        continue
      }

      if (n < this.warmup || n - this.lastOnset < this.refractory) continue
      const fastDb = toDb(this.fast)
      if (fastDb > this.minLevelDb && fastDb - toDb(this.slow) > this.thresholdDb) {
        this.lastOnset = n
        this.tone = { sampleIndex: n, low: 0, total: 0, until: n + this.toneWindow }
        this.pending = {
          sampleIndex: n,
          peak: this.fast,
          brightness: Math.min(1, this.fast / (2 * this.rawFast + EPS)),
          until: n + this.peakWindow,
        }
      }
    }
    return out
  }
}
