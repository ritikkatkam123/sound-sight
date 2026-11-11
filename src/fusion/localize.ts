import { boxMean } from '../vision/motionMath'
import type { MotionSample } from '../vision/motion'

export interface SourceEstimate {
  x: number
  y: number
  /** 0..1 */
  confidence: number
  source: 'motion' | 'fallback'
}

export interface LocalizeOptions {
  /**
   * Look back this far before the onset. Audio reaches us later than the camera frame showing the cause
   * (input latency), and for a clap the hands move *before* the sound.
   */
  beforeMs?: number
  afterMs?: number
  /** Frames this long before the onset count the most (the hands are closing in). */
  peakOffsetMs?: number
  /** Box radii (in grid cells) for the center-surround filter: roughly hand-sized vs. torso-sized. */
  innerRadius?: number
  outerRadius?: number
  /**
   * How hard to penalize motion that spreads beyond a hand-sized area. Compactness is 1 - outer/inner
   * (1 = isolated blob, 0 = middle of a big moving area) and is raised to this power.
   * Squaring it means even the corners of a large moving region (compactness ≈ 0.5) lose to hands.
   */
  compactPower?: number
  /** Local motion below this counts as "nothing moved". */
  minEnergy?: number
}

/**
 * Find where the sound most likely came from:
 * 1. Average the motion grids around the onset, weighting frames just before it most.
 * 2. Score each cell by local motion × compactness, so a hand-sized moving blob beats broad motion (head, torso, lighting).
 * 3. Take the best cell, refine it with a weighted centroid, and fall back to the frame center if nothing moved.
 */
export function localize(
  t: number,
  history: readonly MotionSample[],
  gw: number,
  gh: number,
  opts: LocalizeOptions = {},
): SourceEstimate {
  const {
    beforeMs = 400,
    afterMs = 80,
    peakOffsetMs = 80,
    innerRadius = 1,
    outerRadius = 4,
    compactPower = 2,
    minEnergy = 0.006,
  } = opts
  const fallback: SourceEstimate = { x: 0.5, y: 0.5, confidence: 0, source: 'fallback' }
  if (!gw || !gh) return fallback

  // Triangular time weight: 0 at -beforeMs, 1 at -peakOffsetMs, 0 at +afterMs.
  const acc = new Float32Array(gw * gh)
  let wsum = 0
  for (const s of history) {
    const dt = s.t - t
    if (dt <= -beforeMs || dt >= afterMs) continue
    const w = dt < -peakOffsetMs ? (dt + beforeMs) / (beforeMs - peakOffsetMs) : (afterMs - dt) / (afterMs + peakOffsetMs)
    for (let g = 0; g < acc.length; g++) acc[g] += w * s.grid[g]
    wsum += w
  }
  if (wsum === 0) return fallback
  for (let g = 0; g < acc.length; g++) acc[g] /= wsum

  const inner = boxMean(acc, gw, gh, innerRadius)
  const outer = boxMean(acc, gw, gh, outerRadius)
  const score = new Float32Array(acc.length)
  let best = 0
  for (let g = 0; g < score.length; g++) {
    const compact = inner[g] > 0 ? Math.max(0, 1 - outer[g] / inner[g]) : 0
    score[g] = inner[g] * compact ** compactPower
    if (score[g] > score[best]) best = g
  }
  if (inner[best] < minEnergy || score[best] === 0) return fallback

  const bx = best % gw
  const by = (best / gw) | 0
  let sum = 0
  let cx = 0
  let cy = 0
  for (let y = Math.max(0, by - innerRadius); y <= Math.min(gh - 1, by + innerRadius); y++) {
    for (let x = Math.max(0, bx - innerRadius); x <= Math.min(gw - 1, bx + innerRadius); x++) {
      const v = score[y * gw + x]
      sum += v
      cx += v * (x + 0.5)
      cy += v * (y + 0.5)
    }
  }
  return {
    x: cx / sum / gw,
    y: cy / sum / gh,
    confidence: Math.min(1, score[best] / (minEnergy * 4)),
    source: 'motion',
  }
}
