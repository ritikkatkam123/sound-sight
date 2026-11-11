import { onVideoFrame, type FrameClock } from './frameLoop'
import { diffFrames, toGray } from './motionMath'

export interface MotionSample {
  /** performance.now() timebase (camera capture time when the browser provides it). */
  t: number
  grid: Float32Array
}

const ANALYSIS_WIDTH = 160
const CELL = 5
const HISTORY_MS = 1000

/**
 * Downscales each camera frame, diffs it against the previous one, and keeps a short
 * timestamped history of motion grids, so an audio onset can look back at what moved.
 */
export class MotionTracker {
  readonly history: MotionSample[] = []
  gw = 0
  gh = 0
  /** When set, the latest motion grid is drawn here (debug heatmap). */
  heatCanvas: HTMLCanvasElement | null = null
  /** Smoothed time spent per frame on the main thread, ms. */
  stepMs = 0
  /** Whether frame times come from the camera's capture clock (accurate) or display time (later). */
  clock: FrameClock = 'raf'

  private readonly canvas = document.createElement('canvas')
  private readonly ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
  private prev: Uint8Array | null = null
  private cur: Uint8Array | null = null
  private busy = false
  private stopLoop: (() => void) | null = null
  private readonly video: HTMLVideoElement

  constructor(video: HTMLVideoElement) {
    this.video = video
  }

  start(): void {
    this.stopLoop = onVideoFrame(this.video, (t, clock) => {
      this.clock = clock
      void this.step(t)
    })
  }

  stop(): void {
    this.stopLoop?.()
    this.stopLoop = null
  }

  private async step(t: number): Promise<void> {
    const { videoWidth: vw, videoHeight: vh } = this.video
    if (!vw || !vh || this.busy) return
    this.busy = true
    try {
      const start = performance.now()
      const w = ANALYSIS_WIDTH
      const h = Math.round((ANALYSIS_WIDTH * vh) / vw)
      // Let the browser downscale (usually on the GPU) instead of drawing the full frame on the CPU.
      const bitmap = await createImageBitmap(this.video, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' })
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w
        this.canvas.height = h
        this.prev = new Uint8Array(w * h)
        this.cur = new Uint8Array(w * h)
        this.ctx.drawImage(bitmap, 0, 0)
        bitmap.close()
        toGray(this.ctx.getImageData(0, 0, w, h).data, this.prev)
        return
      }
      this.ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      toGray(this.ctx.getImageData(0, 0, w, h).data, this.cur!)
      const { grid, gw, gh } = diffFrames(this.prev!, this.cur!, w, h, CELL)
      ;[this.prev, this.cur] = [this.cur, this.prev]
      this.gw = gw
      this.gh = gh

      this.history.push({ t, grid })
      while (this.history.length && this.history[0].t < t - HISTORY_MS) this.history.shift()

      if (this.heatCanvas) this.drawHeat(grid, gw, gh)
      this.stepMs = this.stepMs * 0.9 + (performance.now() - start) * 0.1
    } finally {
      this.busy = false
    }
  }

  private drawHeat(grid: Float32Array, gw: number, gh: number): void {
    const c = this.heatCanvas!
    if (c.width !== gw || c.height !== gh) {
      c.width = gw
      c.height = gh
    }
    const hctx = c.getContext('2d')!
    const img = hctx.createImageData(gw, gh)
    for (let i = 0; i < grid.length; i++) {
      const v = Math.min(1, grid[i] * 6)
      img.data[i * 4] = 255
      img.data[i * 4 + 1] = 80 + 150 * (1 - v)
      img.data[i * 4 + 2] = 40
      img.data[i * 4 + 3] = 200 * v
    }
    hctx.putImageData(img, 0, 0)
  }
}
