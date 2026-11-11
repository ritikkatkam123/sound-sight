import { describe, expect, it } from 'vitest'
import { localize } from './localize'
import type { MotionSample } from '../vision/motion'

const GW = 32
const GH = 18

/** Grid with rectangular patches of motion; coords in cells. */
function grid(...patches: { x: number; y: number; w: number; h: number; v: number }[]): Float32Array {
  const g = new Float32Array(GW * GH)
  for (const p of patches) {
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) g[y * GW + x] = p.v
  }
  return g
}

const sample = (t: number, g: Float32Array): MotionSample => ({ t, grid: g })
const hands = { x: 6, y: 10, w: 2, h: 2, v: 0.15 } // centered on cell (7, 11) → (0.219, 0.611)

describe('localize', () => {
  it('falls back to the center when nothing moved', () => {
    expect(localize(1000, [sample(950, grid())], GW, GH)).toMatchObject({ x: 0.5, y: 0.5, source: 'fallback' })
  })

  it('falls back when history is empty or grid size is unknown', () => {
    expect(localize(1000, [], GW, GH).source).toBe('fallback')
    expect(localize(1000, [sample(950, grid(hands))], 0, 0).source).toBe('fallback')
  })

  it('finds a small moving patch just before the onset', () => {
    const r = localize(1000, [sample(920, grid(hands)), sample(960, grid(hands))], GW, GH)
    expect(r.source).toBe('motion')
    expect(r.x).toBeCloseTo(7 / GW, 1)
    expect(r.y).toBeCloseTo(11 / GH, 1)
  })

  it('prefers compact hand motion over a large moving torso', () => {
    // Torso: big area of moderate motion on the right, more total motion than the hands.
    const torso = { x: 16, y: 2, w: 14, h: 16, v: 0.12 }
    const r = localize(1000, [sample(930, grid(hands, torso)), sample(965, grid(hands, torso))], GW, GH)
    expect(r.x).toBeLessThan(0.35)
  })

  it('weights motion near the onset over motion long before it', () => {
    const early = { x: 25, y: 3, w: 2, h: 2, v: 0.15 }
    const r = localize(1000, [sample(640, grid(early)), sample(920, grid(hands))], GW, GH)
    expect(r.x).toBeLessThan(0.35)
  })

  it('ignores motion outside the time window', () => {
    expect(localize(1000, [sample(400, grid(hands)), sample(1500, grid(hands))], GW, GH).source).toBe('fallback')
  })

  it('scales confidence with motion strength', () => {
    const weak = localize(1000, [sample(940, grid({ ...hands, v: 0.02 }))], GW, GH)
    const strong = localize(1000, [sample(940, grid(hands))], GW, GH)
    expect(weak.confidence).toBeLessThan(strong.confidence)
  })
})
