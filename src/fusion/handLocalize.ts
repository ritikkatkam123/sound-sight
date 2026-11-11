import { dist, type HandFrame, type Pt } from '../vision/hands'

export interface HandEstimate {
  x: number
  y: number
  /** 0..1 */
  confidence: number
  /** 'clap': two hands closed in on each other. 'hand': one hand moved sharply (snap, knock, tap). */
  source: 'clap' | 'hand'
}

export interface HandLocalizeOptions {
  /** Width ÷ height of the video, so distances are measured evenly in x and y. */
  aspect?: number
  /** Look back this far for the hands closing in. */
  clapBeforeMs?: number
  /** Look back this far for a single fast-moving hand (snaps are quicker than claps). */
  handBeforeMs?: number
  afterMs?: number
  /** Palms closer than this many hand-sizes count as touching. */
  clapDistance?: number
  /** Palms must have closed by at least this many hand-sizes beforehand (rules out hands simply held together). */
  clapClosing?: number
  /** Fingertip speed (frame heights per second) below which a hand counts as still. */
  minSpeed?: number
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Locate a sound from tracked hands, or return null when the hands don't explain it.
 * 1. Clap: in the frames around the onset, the two palms came together. Answer: the midpoint at their closest.
 * 2. Otherwise the hand whose fingertips moved fastest just before the onset. Answer: its fingertips.
 */
export function localizeHands(t: number, history: readonly HandFrame[], opts: HandLocalizeOptions = {}): HandEstimate | null {
  const {
    aspect = 16 / 9,
    clapBeforeMs = 400,
    handBeforeMs = 250,
    afterMs = 80,
    clapDistance = 1.6,
    clapClosing = 0.6,
    minSpeed = 0.4,
  } = opts

  // --- Clap: two palms converging ---
  let closest: { d: number; at: Pt; t: number } | null = null
  const pairs: { t: number; d: number; at: Pt }[] = []
  for (const f of history) {
    if (f.t < t - clapBeforeMs || f.t > t + afterMs || f.hands.length < 2) continue
    const [a, b] = f.hands
    const handSize = (a.size + b.size) / 2 || 1
    const p = { t: f.t, d: dist(a.palm, b.palm, aspect) / handSize, at: mid(a.palm, b.palm) }
    pairs.push(p)
    if (!closest || p.d < closest.d) closest = p
  }
  if (closest && closest.d < clapDistance) {
    const widest = Math.max(...pairs.filter((p) => p.t <= closest.t).map((p) => p.d))
    const closing = widest - closest.d
    if (closing >= clapClosing) {
      return { x: closest.at.x, y: closest.at.y, confidence: clamp01(0.5 + closing / 4), source: 'clap' }
    }
  }

  // --- Single hand: fastest fingertips just before the onset ---
  let best: { speed: number; at: Pt } | null = null
  let prev: HandFrame | null = null
  for (const f of history) {
    if (f.t > t + afterMs) break
    if (f.t >= t - handBeforeMs && prev && prev.hands.length && f.t > prev.t) {
      const dt = (f.t - prev.t) / 1000
      for (const h of f.hands) {
        // Hands carry no stable identity between frames; match each to the nearest hand in the previous frame.
        const before = prev.hands.reduce((n, c) => (dist(c.palm, h.palm, aspect) < dist(n.palm, h.palm, aspect) ? c : n))
        const speed = dist(h.tips, before.tips, aspect) / dt
        if (!best || speed > best.speed) best = { speed, at: h.tips }
      }
    }
    prev = f
  }
  if (best && best.speed >= minSpeed) {
    return { x: best.at.x, y: best.at.y, confidence: clamp01(best.speed / (minSpeed * 4)), source: 'hand' }
  }
  return null
}
