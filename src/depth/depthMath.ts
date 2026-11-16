/**
 * Pure helpers for the depth scan: normalizing the model's output, smoothing it over time,
 * sampling it, and the maths of the LiDAR-style wave. Kept DOM-free so it's unit testable.
 */

/** A depth map in 0..1, where 1 is nearest. Row-major, `w` × `h`, unmirrored video orientation. */
export interface DepthMap {
  data: Float32Array
  w: number
  h: number
}

/**
 * Robust low/high values of a depth image (default 2nd and 98th percentile), so a few extreme
 * pixels don't squash everything else into a narrow band. Samples at most ~4k values.
 */
export function percentileRange(raw: ArrayLike<number>, lo = 0.02, hi = 0.98): [number, number] {
  const n = raw.length
  if (n === 0) return [0, 1]
  const stride = Math.max(1, Math.floor(n / 4096))
  const sample: number[] = []
  for (let i = 0; i < n; i += stride) sample.push(raw[i])
  sample.sort((a, b) => a - b)
  const at = (q: number) => sample[Math.min(sample.length - 1, Math.max(0, Math.round(q * (sample.length - 1))))]
  return [at(lo), at(hi)]
}

/** Maps `raw` into 0..1 using [lo, hi], clamping outliers. */
export function normalizeInto(raw: ArrayLike<number>, out: Float32Array, lo: number, hi: number): Float32Array {
  const span = hi - lo > 1e-6 ? hi - lo : 1
  for (let i = 0; i < out.length; i++) {
    const v = (raw[i] - lo) / span
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v
  }
  return out
}

/**
 * Turns raw model frames into a steady 0..1 depth map. The model's output scale drifts from frame
 * to frame, so the normalization range and the map itself are both smoothed over time.
 */
export class DepthSmoother {
  private range: [number, number] | null = null
  private map: DepthMap | null = null
  private scratch = new Float32Array(0)
  /** How much of each new frame is mixed in (1 = no smoothing). */
  readonly mapAlpha: number
  readonly rangeAlpha: number

  constructor(mapAlpha = 0.6, rangeAlpha = 0.2) {
    this.mapAlpha = mapAlpha
    this.rangeAlpha = rangeAlpha
  }

  push(raw: ArrayLike<number>, w: number, h: number): DepthMap {
    const [lo, hi] = percentileRange(raw)
    if (!this.range || !this.map || this.map.w !== w || this.map.h !== h) {
      this.range = [lo, hi]
      this.map = { data: new Float32Array(w * h), w, h }
      this.scratch = new Float32Array(w * h)
      normalizeInto(raw, this.map.data, lo, hi)
      return this.map
    }
    const r = this.range
    r[0] += (lo - r[0]) * this.rangeAlpha
    r[1] += (hi - r[1]) * this.rangeAlpha
    normalizeInto(raw, this.scratch, r[0], r[1])
    const d = this.map.data
    const a = this.mapAlpha
    for (let i = 0; i < d.length; i++) d[i] += (this.scratch[i] - d[i]) * a
    return this.map
  }

  reset(): void {
    this.range = null
    this.map = null
  }
}

/** Bilinear depth at normalized video coords (u, v), clamped to the edges. */
export function sampleDepth(map: DepthMap, u: number, v: number): number {
  const { data, w, h } = map
  const x = Math.min(w - 1, Math.max(0, u * w - 0.5))
  const y = Math.min(h - 1, Math.max(0, v * h - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const top = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx
  const bottom = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx
  return top * (1 - fy) + bottom * fy
}

/**
 * How far a point is from the wave's origin, in "scene" units: screen distance (aspect-corrected so
 * the wave is round) plus a depth term, so the wave visibly slows across depth edges and wraps
 * around objects instead of sweeping past like a flat circle.
 */
export function waveDistance(du: number, dv: number, dz: number, aspect: number, depthWeight = 1.2): number {
  const x = du * aspect
  const z = dz * depthWeight
  return Math.sqrt(x * x + dv * dv + z * z)
}

/**
 * Brightness of a point `d` away from the origin when the wavefront is at `radius`:
 * a sharp bright front, with a fading afterglow behind it (the "already scanned" area).
 */
export function frontIntensity(d: number, radius: number, width = 0.05, tail = 0.25): number {
  const off = d - radius
  const front = Math.exp(-(off * off) / (2 * width * width))
  const glow = off < 0 ? 0.35 * Math.exp(off / tail) : 0
  return Math.min(1, front + glow)
}

/**
 * Iso-depth contour lines: 1 right on a band edge, falling to 0 between edges.
 * `bands` lines across the full 0..1 depth range.
 */
export function contour(depth: number, bands = 10, sharpness = 0.18): number {
  const f = depth * bands
  const dist = Math.abs(f - Math.round(f)) // 0 on an edge, 0.5 midway
  return Math.max(0, 1 - dist / sharpness)
}

/** Grid size for a dot lattice covering `width` × `height` pixels with at most `maxDots` dots. */
export function latticeDims(width: number, height: number, spacing: number, maxDots: number): { cols: number; rows: number; spacing: number } {
  let s = Math.max(1, spacing)
  let cols = Math.max(1, Math.ceil(width / s))
  let rows = Math.max(1, Math.ceil(height / s))
  if (cols * rows > maxDots) {
    s = Math.sqrt((width * height) / maxDots)
    cols = Math.max(1, Math.floor(width / s))
    rows = Math.max(1, Math.floor(height / s))
  }
  return { cols, rows, spacing: s }
}

/** Model input size for a video aspect ratio: `width` wide, both sides multiples of 14 (the ViT patch size). */
export function modelInputSize(aspect: number, width = 308): { w: number; h: number } {
  const w = Math.max(14, Math.round(width / 14) * 14)
  const h = Math.max(14, Math.round(w / aspect / 14) * 14)
  return { w, h }
}
