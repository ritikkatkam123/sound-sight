
export interface Pt {
  x: number
  y: number
}

export interface HandPose {
  /** All 21 landmarks, normalized video coords (unmirrored). */
  points: Pt[]
  /** Mean of the wrist and the four finger bases. */
  palm: Pt
  /** Centre of the thumb, index and middle fingertips (where a snap happens). */
  tips: Pt
  /** Wrist → middle-finger base distance, for scale-independent thresholds (aspect-corrected). */
  size: number
}

export interface HandFrame {
  t: number
  hands: HandPose[]
}

const HISTORY_MS = 1000
const PALM = [0, 5, 9, 13, 17]
const TIPS = [4, 8, 12]

const mean = (pts: Pt[], idx: number[]): Pt => ({
  x: idx.reduce((s, i) => s + pts[i].x, 0) / idx.length,
  y: idx.reduce((s, i) => s + pts[i].y, 0) / idx.length,
})

/** Distance in units of frame height, so x and y are measured the same way on a 16:9 frame. */
export function dist(a: Pt, b: Pt, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y)
}

export function toHandPose(lms: Pt[], aspect: number): HandPose {
  const points = lms.map(({ x, y }) => ({ x, y }))
  return { points, palm: mean(points, PALM), tips: mean(points, TIPS), size: dist(points[0], points[9], aspect) }
}

/** Latest hand poses plus a short history, fed by the vision worker's results. */
export class HandTracker {
  readonly history: HandFrame[] = []
  latest: HandPose[] = []
  /** Smoothed inference time, ms. */
  inferMs = 0
  /** Width ÷ height of the camera frames, for aspect-correct distances. */
  aspect = 16 / 9

  ingest(t: number, hands: Pt[][], aspect: number, ms: number): void {
    this.aspect = aspect
    this.inferMs = this.inferMs * 0.9 + ms * 0.1
    this.latest = hands.map((pts) => toHandPose(pts, aspect))
    this.history.push({ t, hands: this.latest })
    while (this.history.length && this.history[0].t < t - HISTORY_MS) this.history.shift()
  }

  clear(): void {
    this.latest = []
    this.history.length = 0
  }
}
