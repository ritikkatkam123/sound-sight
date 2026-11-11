import { onVideoFrame } from './frameLoop'
import { FaceTracker } from './face'
import { HandTracker } from './hands'
import type { VisionRequest, VisionResponse } from './visionProtocol'

export type ModelStatus = 'loading' | 'ready' | 'off' | 'error'

/** Frames are downscaled before going to the worker; the models work at ~200 px internally anyway. */
const SEND_WIDTH = 640

/**
 * Sends camera frames to the vision worker and routes results into the hand and face trackers.
 * Only one frame is in flight at a time: if the worker is still busy, the new frame is skipped,
 * so a slow device drops frames instead of building up a backlog.
 */
export class VisionClient {
  readonly hands = new HandTracker()
  readonly face = new FaceTracker()
  readonly status: { hands: ModelStatus; face: ModelStatus } = { hands: 'loading', face: 'loading' }
  handsEnabled = true
  faceEnabled = true
  /** Run the face model on every Nth frame; the mouth moves slowly next to a clap. */
  faceEveryNth = 2

  private readonly worker = new Worker(new URL('./visionWorker.ts', import.meta.url), { type: 'module' })
  private stopLoop: (() => void) | null = null
  private busy = false
  private frame = 0
  private readonly video: HTMLVideoElement

  constructor(video: HTMLVideoElement) {
    this.video = video
    this.worker.onmessage = (e: MessageEvent<VisionResponse>) => this.onMessage(e.data)
    this.worker.onerror = (e) => {
      console.error('Vision worker crashed', e)
      this.status.hands = this.status.face = 'error'
    }
  }

  start(): void {
    this.post({ type: 'init' })
    this.stopLoop = onVideoFrame(this.video, (t) => void this.send(t))
  }

  get handsActive(): boolean {
    return this.handsEnabled && this.status.hands === 'ready'
  }

  setEnabled(hands: boolean, face: boolean): void {
    if (!hands) this.hands.clear()
    if (!face) this.face.clear()
    this.handsEnabled = hands
    this.faceEnabled = face
  }

  dispose(): void {
    this.stopLoop?.()
    this.post({ type: 'close' })
    this.worker.terminate()
  }

  private async send(t: number): Promise<void> {
    const { videoWidth: vw, videoHeight: vh } = this.video
    const wantFace = this.faceEnabled && this.status.face === 'ready' && this.frame++ % this.faceEveryNth === 0
    const wantHands = this.handsActive
    if (this.busy || !vw || !vh || (!wantHands && !wantFace)) return
    this.busy = true
    try {
      const w = Math.min(SEND_WIDTH, vw)
      const bitmap = await createImageBitmap(this.video, { resizeWidth: w, resizeHeight: Math.round((w * vh) / vw) })
      this.post({ type: 'frame', t, bitmap, aspect: vw / vh, hands: wantHands, face: wantFace }, [bitmap])
    } catch (e) {
      this.busy = false
      throw e
    }
  }

  private onMessage(msg: VisionResponse): void {
    if (msg.type === 'ready') this.status[msg.task] = 'ready'
    else if (msg.type === 'error') {
      console.error(`Vision model "${msg.task}" failed to load:`, msg.message)
      this.status[msg.task] = 'error'
    } else {
      this.busy = false
      const aspect = this.video.videoWidth / this.video.videoHeight || 16 / 9
      if (msg.hands && this.handsEnabled) this.hands.ingest(msg.t, msg.hands, aspect, msg.handsMs)
      if (msg.mouth !== undefined && this.faceEnabled) this.face.ingest(msg.t, msg.mouth, msg.faceMs)
    }
  }

  private post(msg: VisionRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer)
  }
}
