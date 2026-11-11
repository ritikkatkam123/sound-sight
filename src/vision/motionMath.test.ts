import { describe, expect, it } from 'vitest'
import { boxMean, diffFrames, toGray } from './motionMath'

const W = 160
const H = 90

function frame(fill = 100) {
  return new Uint8Array(W * H).fill(fill)
}

function paintRect(f: Uint8Array, x0: number, y0: number, w: number, h: number, v: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) f[y * W + x] = v
}

describe('toGray', () => {
  it('converts RGBA to luma', () => {
    const out = new Uint8Array(3)
    toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]), out)
    expect(out[0]).toBeGreaterThan(250)
    expect(out[1]).toBe(0)
    expect(out[2]).toBeGreaterThan(60)
    expect(out[2]).toBeLessThan(90)
  })
})

describe('diffFrames', () => {
  it('produces a 32×18 grid for a 160×90 frame with 5px cells', () => {
    const { gw, gh, grid } = diffFrames(frame(), frame(), W, H, 5)
    expect([gw, gh, grid.length]).toEqual([32, 18, 576])
  })

  it('reports no motion for identical frames', () => {
    expect(Math.max(...diffFrames(frame(), frame(), W, H, 5).grid)).toBe(0)
  })

  it('ignores small sensor noise', () => {
    const cur = frame()
    for (let i = 0; i < cur.length; i += 3) cur[i] += 10
    expect(Math.max(...diffFrames(frame(), cur, W, H, 5).grid)).toBe(0)
  })

  it('marks only the cells that changed', () => {
    const cur = frame()
    paintRect(cur, 20, 10, 5, 5, 230) // exactly cell (4, 2)
    const { grid, gw } = diffFrames(frame(), cur, W, H, 5)
    expect(grid[2 * gw + 4]).toBeCloseTo(130 / 255, 3)
    expect(grid.filter((v) => v > 0)).toHaveLength(1)
  })
})

describe('boxMean', () => {
  it('spreads a single hot cell over its neighbors', () => {
    const g = new Float32Array(25)
    g[12] = 9 // center of 5×5
    const m = boxMean(g, 5, 5, 1)
    expect(m[12]).toBeCloseTo(1)
    expect(m[6]).toBeCloseTo(1)
    expect(m[0]).toBeCloseTo(0)
  })

  it('handles edges by averaging only cells that exist', () => {
    const m = boxMean(new Float32Array(25).fill(2), 5, 5, 2)
    expect([...m].every((v) => Math.abs(v - 2) < 1e-6)).toBe(true)
  })
})
