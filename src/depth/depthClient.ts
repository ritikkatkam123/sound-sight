import { onVideoFrame } from '../vision/frameLoop'
import { DepthSmoother, modelInputSize, type DepthMap } from './depthMath'
import type { DepthRequest, DepthResponse } from './depthProtocol'

export type DepthStatus = 'loading' | 'ready' | 'unsupported' | 'error'

/** Depth changes slowly next to a clap; ~8 updates a second is plenty and keeps the GPU free. */
const MAX_FPS = 8

/**
 * Sends camera frames to the depth worker and keeps a smoothed depth map of the scene.
 * Like the vision client, only one frame is in flight at a time, so slow devices drop frames
 * instead of queueing them. Created only when a depth feature is switched on (the model is ~50 MB).
 */
export class DepthClient {
  status: DepthStatus = 'loading'
  /** Download progress of the model, in bytes. */
  progress = { loaded: 0, total: 0 }
  message = ''
  inferMs = 0
  /** Latest smoothed depth map (1 = nearest), or null before the first result. */
  map: DepthMap | null = null
  /** Increments whenever `map` changes, so renderers can skip unchanged frames. */
  version = 0

  private readonly worker = new Worker(new URL('./depthWorker.ts', import.meta.url), { type: 'module' })
  private readonly smoother = new DepthSmoother()
  private readonly video: HTMLVideoElement
  private stopLoop: (() => void) | null = null
  private busy = false
  private lastSent = 0
  private size: { w: number; h: number } | null = null

  constructor(video: HTMLVideoElement) {
    this.video = video
    this.worker.onmessage = (e: MessageEvent<DepthResponse>) => this.onMessage(e.data)
    this.worker.onerror = (e) => {
      console.error('Depth worker crashed', e)
      this.status = 'error'
      this.message = e.message
    }
  }

  get ready(): boolean {
    return this.status === 'ready'
  }

  start(): void {
    const aspect = this.video.videoWidth / this.video.videoHeight || 4 / 3
    this.size = modelInputSize(aspect)
    this.post({ type: 'init', ...this.size })
    this.stopLoop = onVideoFrame(this.video, (t) => void this.send(t))
  }

  dispose(): void {
    this.stopLoop?.()
    this.post({ type: 'close' })
    this.worker.terminate()
  }

  private async send(t: number): Promise<void> {
    const now = performance.now()
    if (!this.ready || this.busy || !this.size || now - this.lastSent < 1000 / MAX_FPS || !this.video.videoWidth) return
    this.busy = true
    this.lastSent = now
    try {
      const bitmap = await createImageBitmap(this.video, {
        resizeWidth: this.size.w,
        resizeHeight: this.size.h,
        resizeQuality: 'medium',
      })
      this.post({ type: 'frame', t, bitmap }, [bitmap])
    } catch (e) {
      this.busy = false
      throw e
    }
  }

  private onMessage(msg: DepthResponse): void {
    switch (msg.type) {
      case 'progress':
        this.progress = { loaded: msg.loaded, total: msg.total }
        break
      case 'ready':
        this.status = 'ready'
        break
      case 'unsupported':
        this.status = 'unsupported'
        this.message = msg.message
        break
      case 'error':
        console.error('Depth model failed:', msg.message)
        this.busy = false
        this.status = 'error'
        this.message = msg.message
        break
      case 'result':
        this.busy = false
        this.inferMs = msg.inferMs
        this.map = this.smoother.push(msg.depth, msg.w, msg.h)
        this.version++
        break
    }
  }

  private post(msg: DepthRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer)
  }
}
