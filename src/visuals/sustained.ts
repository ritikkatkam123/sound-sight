import type { Classification } from '../audio/classifier'
import type { AudioFeatures } from '../audio/micStream'
import type { Pt } from '../vision/hands'
import type { Stage } from './stage'
import { spectrumColors, voiceEffect, whistleEffect } from './effects'

export interface SustainedInput {
  /** Latest rolling classification and when it was made (performance.now()). */
  classification: Classification | null
  classifiedAt: number
  mouth: Pt | null
  features: () => AudioFeatures
  waveShape: () => Float32Array
  bands: () => Float32Array
}

// How often voice rings and whistle notes are emitted, ms, and the classifier score that turns each effect on.
const RATES = { voice: 110, whistle: 220 } as const
const MIN_SCORE = { voice: 0.3, whistle: 0.25, music: 0.3 } as const
/** Ignore classifications older than this (the rolling classifier runs every ~250 ms). */
const STALE_MS = 700
/** Where voice/whistle effects appear if the face isn't tracked. */
const NO_FACE: Pt = { x: 0.5, y: 0.4 }
/** Pitch detection is costly; reuse features for this long. */
const FEATURE_MS = 60
const BANDS = 32

/** Drives the continuous effects (voice, whistle, music) from the rolling classification. */
export class SustainedEffects {
  private last = { voice: 0, whistle: 0 }
  private cached: { at: number; f: AudioFeatures } | null = null
  private readonly stage: Stage

  constructor(stage: Stage) {
    this.stage = stage
  }

  update(now: number, input: SustainedInput): void {
    const c = input.classification
    const fresh = c && now - input.classifiedAt <= STALE_MS
    const cat = fresh ? c.category : null

    // The equalizer is redrawn every frame while music plays, then fades out by itself.
    if (cat === 'music' && c!.score >= MIN_SCORE.music) this.stage.setSpectrum(input.bands(), spectrumColors(BANDS, now / 1000))
    else this.stage.setSpectrum(null)

    if (cat !== 'voice' && cat !== 'whistle') return
    if (c!.score < MIN_SCORE[cat] || now - this.last[cat] < RATES[cat]) return
    if (!this.cached || now - this.cached.at > FEATURE_MS) this.cached = { at: now, f: input.features() }
    const f = this.cached.f
    if (f.levelDb < -55) return // the classifier window still says "voice" but it has gone quiet
    this.last[cat] = now

    const mouth = input.mouth ?? NO_FACE
    if (cat === 'voice') voiceEffect(this.stage, mouth, f, input.waveShape())
    else whistleEffect(this.stage, mouth, f)
  }
}
