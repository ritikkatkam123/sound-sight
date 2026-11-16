import { describe, expect, it } from 'vitest'
import {
  contour,
  DepthSmoother,
  frontIntensity,
  latticeDims,
  modelInputSize,
  normalizeInto,
  percentileRange,
  sampleDepth,
  waveDistance,
  type DepthMap,
} from './depthMath'

describe('percentileRange / normalizeInto', () => {
  it('ignores a few extreme outliers', () => {
    const raw = Float32Array.from({ length: 1000 }, (_, i) => i / 999)
    raw[0] = -1000
    raw[999] = 1000
    const [lo, hi] = percentileRange(raw)
    expect(lo).toBeGreaterThan(0)
    expect(lo).toBeLessThan(0.05)
    expect(hi).toBeGreaterThan(0.95)
    expect(hi).toBeLessThan(1)
  })

  it('maps into 0..1 and clamps', () => {
    const out = normalizeInto([0, 5, 10, 20, -3], new Float32Array(5), 0, 10)
    expect(Array.from(out)).toEqual([0, 0.5, 1, 1, 0])
  })

  it('handles a flat image without dividing by zero', () => {
    const out = normalizeInto([3, 3, 3], new Float32Array(3), 3, 3)
    expect(Array.from(out).every(Number.isFinite)).toBe(true)
  })
})

describe('DepthSmoother', () => {
  const ramp = (scale: number) => Float32Array.from({ length: 100 }, (_, i) => (i / 99) * scale)

  it('normalizes the first frame directly', () => {
    const m = new DepthSmoother().push(ramp(50), 10, 10)
    expect(m.data[0]).toBeCloseTo(0, 1)
    expect(m.data[99]).toBeCloseTo(1, 1)
  })

  it('stays steady when the model output scale jumps', () => {
    const s = new DepthSmoother()
    const before = s.push(ramp(1), 10, 10).data[50]
    // Same scene, but the model suddenly reports values 3× larger.
    const after = s.push(ramp(3), 10, 10).data[50]
    expect(Math.abs(after - before)).toBeLessThan(0.3)
  })

  it('starts over when the size changes', () => {
    const s = new DepthSmoother()
    s.push(ramp(1), 10, 10)
    const m = s.push(new Float32Array(4).fill(1), 2, 2)
    expect(m.w).toBe(2)
    expect(m.data.length).toBe(4)
  })
})

describe('sampleDepth', () => {
  // 2×2: left column 0, right column 1.
  const map: DepthMap = { data: Float32Array.from([0, 1, 0, 1]), w: 2, h: 2 }

  it('returns pixel values at pixel centres', () => {
    expect(sampleDepth(map, 0.25, 0.25)).toBeCloseTo(0)
    expect(sampleDepth(map, 0.75, 0.75)).toBeCloseTo(1)
  })

  it('interpolates between pixels', () => {
    expect(sampleDepth(map, 0.5, 0.5)).toBeCloseTo(0.5)
  })

  it('clamps outside the image', () => {
    expect(sampleDepth(map, -1, 0.5)).toBeCloseTo(0)
    expect(sampleDepth(map, 2, 0.5)).toBeCloseTo(1)
  })
})

describe('scan wave', () => {
  it('is round on a wide screen thanks to the aspect correction', () => {
    const aspect = 16 / 9
    // Equal on-screen distances: 0.2 of the height vertically, 0.2/aspect of the width horizontally.
    expect(waveDistance(0.2 / aspect, 0, 0, aspect)).toBeCloseTo(waveDistance(0, 0.2, 0, aspect))
  })

  it('treats a depth step as extra distance', () => {
    expect(waveDistance(0.1, 0, 0.5, 1)).toBeGreaterThan(waveDistance(0.1, 0, 0, 1))
  })

  it('is brightest on the front, glows behind it, and is dark ahead of it', () => {
    const r = 0.5
    const onFront = frontIntensity(0.5, r)
    const behind = frontIntensity(0.3, r)
    const ahead = frontIntensity(0.7, r)
    expect(onFront).toBeCloseTo(1)
    expect(behind).toBeGreaterThan(0.05)
    expect(behind).toBeLessThan(onFront)
    expect(ahead).toBeLessThan(0.01)
  })

  it('draws contour lines on band edges only', () => {
    expect(contour(0.5, 10)).toBeCloseTo(1)
    expect(contour(0.55, 10)).toBe(0)
  })
})

describe('sizes', () => {
  it('keeps the lattice under the dot budget', () => {
    const { cols, rows } = latticeDims(2560, 1440, 8, 6000)
    expect(cols * rows).toBeLessThanOrEqual(6000)
    expect(cols / rows).toBeCloseTo(2560 / 1440, 0)
  })

  it('uses the requested spacing when it fits', () => {
    expect(latticeDims(140, 70, 14, 6000)).toEqual({ cols: 10, rows: 5, spacing: 14 })
  })

  it('picks model input sides that are multiples of 14', () => {
    const { w, h } = modelInputSize(16 / 9)
    expect(w % 14).toBe(0)
    expect(h % 14).toBe(0)
    expect(w / h).toBeCloseTo(16 / 9, 0)
  })
})
