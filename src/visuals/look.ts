/** How the effects are rendered, independent of which sound triggered them. */
export interface Look {
  /** Bloom strength, 0 (off) .. 1. */
  glow: number
  /** How long effects smear behind them, 0 (off) .. 1 (long trails). */
  trails: number
  /** Particle count and size multiplier, 0.5 .. 2. */
  intensity: number
  /** Whether claps shake the view. */
  shake: boolean
}

export type PresetName = 'neon' | 'dreamy' | 'minimal' | 'party'

export const PRESETS: Record<PresetName, Look> = {
  neon: { glow: 0.6, trails: 0.25, intensity: 1, shake: true },
  dreamy: { glow: 0.9, trails: 0.8, intensity: 0.8, shake: false },
  minimal: { glow: 0, trails: 0, intensity: 0.6, shake: false },
  party: { glow: 1, trails: 0.5, intensity: 1.8, shake: true },
}

export const DEFAULT_LOOK = PRESETS.neon

/** The preset this look matches exactly, or 'custom' once a slider has moved. */
export function matchPreset(look: Look): PresetName | 'custom' {
  for (const [name, p] of Object.entries(PRESETS) as [PresetName, Look][]) {
    if (p.glow === look.glow && p.trails === look.trails && p.intensity === look.intensity && p.shake === look.shake) {
      return name
    }
  }
  return 'custom'
}

/** Per-frame alpha kept from the previous frame's effects. Capped below 1 so trails always fade out. */
export function trailDecay(trails: number): number {
  return Math.min(0.94, Math.max(0, trails) * 0.94)
}
