import { Color } from 'pixi.js'
import type { SoundCategory } from '../audio/categories'
import type { AudioFeatures } from '../audio/micStream'
import type { Pt } from '../vision/hands'
import type { ParticleGroup, Stage } from './stage'
import { pitchColor } from './palette'

// Each category has its own visual language, not just its own colour:
//   clap    → shockwave: flash, shake, blast rings, spray
//   snap    → electricity: crackling lightning from the fingertips
//   knock   → water: flat ripples and droplets that splash up and fall back
//   voice   → the live waveform, wrapped into rings leaving the mouth
//   whistle → musical notes floating up, tinted by the note
//   music   → equalizer bars along the bottom, driven by the live spectrum

export const CATEGORY_COLOR: Record<SoundCategory, number> = {
  clap: 0x5ef2ff,
  snap: 0xffe066,
  knock: 0x4cc3ff,
  voice: 0xff7ad9,
  whistle: 0x6dffb0,
  music: 0xb98cff,
  other: 0xe8ecf4,
}

const loudness = (f: AudioFeatures) => Math.min(1, Math.max(0, (f.levelDb + 50) / 35))

/** Shown the instant an onset fires, before we know what the sound was. */
export function onsetEffect(stage: Stage, at: Pt, intensity: number, color: number): ParticleGroup {
  return stage.burst(at.x, at.y, intensity, color)
}

/** Category-specific visual added once the classifier has labelled an impulsive sound. */
export function accentEffect(stage: Stage, category: SoundCategory, at: Pt, intensity: number): void {
  const color = CATEGORY_COLOR[category]
  const { x: nx, y: ny } = at
  switch (category) {
    case 'clap':
      stage.flash(color, 0.12 + 0.1 * intensity)
      stage.shake(4 + 8 * intensity)
      stage.ring({ nx, ny, color, radius: 12, speed: 620 * (0.6 + intensity), width: 8, life: 0.55 })
      stage.ring({ nx, ny, color: 0xffffff, radius: 6, speed: 380 * (0.6 + intensity), width: 3, life: 0.7 })
      stage.spawn({ nx, ny, color, count: 40, speed: [300, 800], size: [6, 14], life: [0.5, 1.0], drag: 0.9 })
      break
    case 'snap':
      stage.bolt({ nx, ny, color, count: 5 + Math.round(3 * intensity), length: [60, 110 + 60 * intensity], life: 0.28 })
      stage.spawn({ nx, ny, color: 0xffffff, count: 14, speed: [300, 600], size: [2, 5], life: [0.15, 0.3], drag: 0.85, gravity: 0 })
      break
    case 'knock':
      for (let i = 0; i < 3; i++) {
        stage.ring({ nx, ny, color, radius: 6 + i * 22, speed: 170, width: 4 - i, life: 1.2 - i * 0.2, squash: 0.35 })
      }
      // Droplets thrown up from the surface, falling back under gravity.
      stage.spawn({ nx, ny, color, count: 16, speed: [220, 480 * (0.6 + intensity)], angle: [-Math.PI * 0.85, -Math.PI * 0.15], size: [5, 10], life: [0.6, 0.9], drag: 0.995, gravity: 1100 })
      break
    case 'other':
      stage.ring({ nx, ny, color, radius: 8, speed: 200, width: 2, alpha: 0.5, life: 0.5 })
      break
    // Sustained sounds are drawn continuously by SustainedEffects instead.
    case 'voice':
    case 'whistle':
    case 'music':
      break
  }
}

/** The live waveform wrapped into a ring that expands out of the mouth; louder → faster and spikier. */
export function voiceEffect(stage: Stage, mouth: Pt, f: AudioFeatures, wave: Float32Array): void {
  const loud = loudness(f)
  const color = f.pitchHz ? pitchColor(f.pitchHz) : CATEGORY_COLOR.voice
  stage.ring({
    nx: mouth.x,
    ny: mouth.y,
    color,
    radius: 22,
    speed: 120 + 200 * loud,
    width: 2 + 2 * loud,
    life: 1.0,
    squash: 0.75,
    alpha: 0.35 + 0.45 * loud,
    wave,
    amp: 6 + 22 * loud,
  })
}

const NOTES = ['♪', '♫', '♩', '♬']

/** Music notes drifting up and swaying, tinted by the whistled pitch. */
export function whistleEffect(stage: Stage, mouth: Pt, f: AudioFeatures): void {
  const color = f.pitchHz ? pitchColor(f.pitchHz, 95, 66) : CATEGORY_COLOR.whistle
  stage.glyph({
    nx: mouth.x,
    ny: mouth.y,
    text: NOTES[Math.floor(Math.random() * NOTES.length)],
    color,
    size: 26 + 26 * loudness(f),
    vx: (Math.random() - 0.5) * 80,
    vy: -90 - Math.random() * 60,
    sway: 14,
    life: 1.8,
  })
}

/** Rainbow equalizer colours, rotating slowly over time. */
export function spectrumColors(count: number, timeS: number): number[] {
  return Array.from({ length: count }, (_, i) => new Color({ h: (i * (300 / count) + timeS * 20) % 360, s: 85, l: 62 }).toNumber())
}
