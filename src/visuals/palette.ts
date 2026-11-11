import { Color } from 'pixi.js'

/** Dull/low sounds → warm orange, bright/sharp sounds → cyan/violet. */
export function brightnessColor(brightness: number): number {
  const b = Math.min(1, Math.max(0, brightness))
  return new Color({ h: 25 + b * 245, s: 95, l: 62 }).toNumber()
}

/** Map peak level (dBFS) to effect intensity: ~0 for faint taps, ~1.5 for loud claps. */
export function levelIntensity(levelDb: number): number {
  return Math.min(1.5, Math.max(0.1, (levelDb + 45) / 30))
}

/** Pitch on a log scale → hue: low notes red/orange, high notes blue/violet. */
export function pitchColor(hz: number, saturation = 90, lightness = 62): number {
  const t = Math.min(1, Math.max(0, Math.log2(hz / 100) / Math.log2(2000 / 100)))
  return new Color({ h: t * 280, s: saturation, l: lightness }).toNumber()
}
