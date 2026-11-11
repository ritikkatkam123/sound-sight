import type { SoundCategory } from '../audio/categories'

export interface SoundEvent {
  /** Onset time, performance.now() timebase. */
  t: number
  x: number
  y: number
  confidence: number
  source: 'clap' | 'hand' | 'motion' | 'fallback'
  levelDb: number
  brightness: number
  /** Time from the onset to the visual spawning. */
  latencyMs: number
  /** Filled in ~150 ms later, once the classifier has labelled the sound. */
  category?: SoundCategory
  categoryScore?: number
}

type Listener = (e: SoundEvent) => void

export class EventBus {
  private listeners = new Set<Listener>()

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit(e: SoundEvent): void {
    for (const fn of this.listeners) fn(e)
  }
}
