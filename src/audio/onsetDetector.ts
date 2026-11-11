// Pure onset detection, so it can run inside the AudioWorklet and in unit tests.
//
// It compares a fast (~2 ms) and a slow (~300 ms) energy envelope of the
// first-differenced signal. Differencing works as a cheap high-pass filter: claps, snaps
// and knocks are broadband transients, so they show up strongly, while hum and low voices are suppressed.
// An onset fires when the fast envelope jumps well above the slow one.
// After that we keep listening for a few ms to measure the peak level before reporting it.

export interface OnsetConfig {
  sampleRate: number
  /** How far (dB) the fast envelope must rise above the slow one. Lower means more sensitive. */
  thresholdDb?: number
  /** Ignore anything quieter than this (dBFS of the differenced signal). */
  minLevelDb?: number
  refractoryMs?: number
  /** How long after the trigger to keep measuring the peak before reporting. */
  peakWindowMs?: number
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

  private fast = 0
  private slow = 0
  private rawFast = 0
  private prev = 0
  private index = 0
  private lastOnset = -Infinity
  private pending: { sampleIndex: number; peak: number; brightness: number; until: number } | null = null

  constructor(cfg: OnsetConfig) {
    const sr = cfg.sampleRate
    this.thresholdDb = cfg.thresholdDb ?? 10
    this.minLevelDb = cfg.minLevelDb ?? -45
    this.fastCoef = Math.exp(-1 / (0.002 * sr))
    this.slowCoef = Math.exp(-1 / (0.3 * sr))
    this.refractory = ((cfg.refractoryMs ?? 150) / 1000) * sr
    this.peakWindow = ((cfg.peakWindowMs ?? 12) / 1000) * sr
    this.warmup = ((cfg.warmupMs ?? 300) / 1000) * sr
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
      const n = this.index++

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
