import type { Pt } from './hands'
import type { MouthResult } from './visionProtocol'

export interface MouthState {
  t: number
  /** Centre between the inner lips, normalized video coords (unmirrored). */
  center: Pt
  /** Lip gap ÷ mouth width: ~0 closed, ~0.5+ wide open. */
  open: number
}

const HISTORY_MS = 1000

/** Latest mouth position plus a short history, fed by the vision worker (used to place voice/whistle visuals). */
export class FaceTracker {
  readonly history: MouthState[] = []
  latest: MouthState | null = null
  inferMs = 0

  ingest(t: number, mouth: MouthResult | null, ms: number): void {
    this.inferMs = this.inferMs * 0.9 + ms * 0.1
    this.latest = mouth && { t, ...mouth }
    if (!this.latest) return
    this.history.push(this.latest)
    while (this.history.length && this.history[0].t < t - HISTORY_MS) this.history.shift()
  }

  clear(): void {
    this.latest = null
    this.history.length = 0
  }
}
