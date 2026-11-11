// Pure audio feature helpers (no Web Audio), unit-testable.

/** RMS level in dBFS, floored at -100. */
export function levelDb(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  const rms = Math.sqrt(sum / buf.length)
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100
}

/**
 * Fundamental frequency by normalized autocorrelation, or null when the signal isn't clearly pitched
 * (noise, clicks, silence). Good enough for whistles and sung or spoken vowels.
 */
export function estimatePitch(buf: Float32Array, sampleRate: number, minHz = 80, maxHz = 2000, clarity = 0.8): number | null {
  const minLag = Math.floor(sampleRate / maxHz)
  const maxLag = Math.min(Math.ceil(sampleRate / minHz), buf.length >> 1)
  let energy = 0
  for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i]
  if (energy < 1e-6) return null

  const n = buf.length - maxLag
  const corr = (lag: number) => {
    let c = 0
    let e1 = 0
    let e2 = 0
    for (let i = 0; i < n; i++) {
      c += buf[i] * buf[i + lag]
      e1 += buf[i] * buf[i]
      e2 += buf[i + lag] * buf[i + lag]
    }
    return c / Math.sqrt(e1 * e2 + 1e-12)
  }

  // Take the first lag that's close to the best peak; this avoids octave errors (picking 2× the period).
  const values = new Float32Array(maxLag + 2)
  let best = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    values[lag] = corr(lag)
    if (values[lag] > best) best = values[lag]
  }
  if (best < clarity) return null
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const v = values[lag]
    if (v >= 0.9 * best && v >= values[lag - 1] && v >= values[lag + 1]) {
      // Parabolic interpolation for sub-sample accuracy.
      const a = values[lag - 1]
      const c = values[lag + 1]
      const shift = (a - c) / (2 * (a - 2 * v + c) || 1)
      return sampleRate / (lag + shift)
    }
  }
  return null
}

/** Spectral centroid in Hz from an AnalyserNode's dB spectrum. */
export function spectralCentroid(spectrumDb: Float32Array, sampleRate: number): number {
  const binHz = sampleRate / 2 / spectrumDb.length
  let num = 0
  let den = 0
  for (let i = 1; i < spectrumDb.length; i++) {
    const mag = 10 ** (spectrumDb[i] / 20)
    num += mag * i * binHz
    den += mag
  }
  return den > 0 ? num / den : 0
}

/**
 * A stable snapshot of the waveform's shape: `points` samples from `span` input samples, starting at
 * a rising zero crossing (so consecutive snapshots line up) and normalized to -1..1.
 */
export function waveShape(buf: Float32Array, points = 64, span = 512): Float32Array {
  let start = 0
  for (let i = 1; i < buf.length - span; i++) {
    if (buf[i - 1] < 0 && buf[i] >= 0) {
      start = i
      break
    }
  }
  const out = new Float32Array(points)
  const len = Math.min(span, buf.length - start)
  let peak = 0
  for (let p = 0; p < points; p++) {
    out[p] = buf[start + Math.floor((p * len) / points)]
    peak = Math.max(peak, Math.abs(out[p]))
  }
  if (peak > 0) for (let p = 0; p < points; p++) out[p] /= peak
  return out
}

/**
 * Collapse an AnalyserNode dB spectrum into `bands` log-spaced bands between minHz and maxHz,
 * each 0..1 (mapping floorDb..ceilDb). Log spacing matches how we hear pitch.
 */
export function logBands(
  spectrumDb: Float32Array,
  sampleRate: number,
  bands = 32,
  minHz = 60,
  maxHz = 12000,
  floorDb = -95,
  ceilDb = -25,
): Float32Array {
  const binHz = sampleRate / 2 / spectrumDb.length
  const out = new Float32Array(bands)
  for (let b = 0; b < bands; b++) {
    const lo = minHz * (maxHz / minHz) ** (b / bands)
    const hi = minHz * (maxHz / minHz) ** ((b + 1) / bands)
    const from = Math.max(0, Math.floor(lo / binHz))
    const to = Math.min(spectrumDb.length - 1, Math.max(from, Math.ceil(hi / binHz) - 1))
    let max = -Infinity
    for (let i = from; i <= to; i++) max = Math.max(max, spectrumDb[i])
    out[b] = Math.min(1, Math.max(0, (max - floorDb) / (ceilDb - floorDb)))
  }
  return out
}
