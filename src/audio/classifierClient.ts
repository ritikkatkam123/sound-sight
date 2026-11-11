import type { AudioTap } from './audioTap'
import { WINDOW_S, type Classification } from './classifier'
import type { ClassifierRequest, ClassifierResponse } from './classifierWorker'
import type { ModelStatus } from '../vision/visionClient'

/** Main-thread handle to the classifier worker: grabs the newest audio window and classifies it there. */
export class ClassifierClient {
  status: ModelStatus = 'loading'
  private readonly worker = new Worker(new URL('./classifierWorker.ts', import.meta.url), { type: 'module' })
  private readonly pending = new Map<number, (r: Classification | null) => void>()
  private nextId = 0
  private readonly tap: AudioTap

  constructor(tap: AudioTap) {
    this.tap = tap
    this.worker.onmessage = (e: MessageEvent<ClassifierResponse>) => {
      const msg = e.data
      if (msg.type === 'ready') this.status = 'ready'
      else if (msg.type === 'error') {
        console.error('Sound classifier failed to load:', msg.message)
        this.status = 'error'
      } else {
        this.pending.get(msg.id)?.(msg.result)
        this.pending.delete(msg.id)
      }
    }
  }

  /** Classify the newest audio window, or resolve null if the model or a full window isn't ready yet. */
  classify(): Promise<Classification | null> {
    const n = Math.round(WINDOW_S * this.tap.sampleRate)
    if (this.status !== 'ready' || this.tap.ring.length < n) return Promise.resolve(null)
    const id = this.nextId++
    const samples = this.tap.ring.latest(n)
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.post({ type: 'classify', id, samples, sampleRate: this.tap.sampleRate }, [samples.buffer])
    })
  }

  dispose(): void {
    this.post({ type: 'close' })
    this.worker.terminate()
    for (const resolve of this.pending.values()) resolve(null)
    this.pending.clear()
  }

  private post(msg: ClassifierRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer)
  }
}
