// Pure frame-differencing helpers (no DOM), kept separate so they can be unit tested.

export interface MotionGrid {
  /** Mean per-cell change, 0..1, row-major gw × gh. */
  grid: Float32Array
  gw: number
  gh: number
}

/** RGBA → luma (0..255) into `out`. */
export function toGray(rgba: Uint8ClampedArray, out: Uint8Array): void {
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8
  }
}

/**
 * Diff two grayscale frames into a coarse grid of mean change per cell (0..1).
 * Per-pixel changes below `noise` are ignored to suppress sensor noise.
 */
export function diffFrames(prev: Uint8Array, cur: Uint8Array, w: number, h: number, cell: number, noise = 18): MotionGrid {
  const gw = Math.ceil(w / cell)
  const gh = Math.ceil(h / cell)
  const sums = new Float32Array(gw * gh)
  const counts = new Float32Array(gw * gh)

  for (let y = 0; y < h; y++) {
    const gy = (y / cell) | 0
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const d = Math.abs(cur[i] - prev[i])
      const g = gy * gw + ((x / cell) | 0)
      if (d > noise) sums[g] += d
      counts[g]++
    }
  }

  const grid = new Float32Array(gw * gh)
  for (let g = 0; g < grid.length; g++) grid[g] = sums[g] / (counts[g] * 255)
  return { grid, gw, gh }
}

/** Mean over a (2r+1)² box around each cell, clipped at the edges. */
export function boxMean(grid: Float32Array, gw: number, gh: number, r: number): Float32Array {
  const out = new Float32Array(grid.length)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let sum = 0
      let n = 0
      for (let yy = Math.max(0, y - r); yy <= Math.min(gh - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(gw - 1, x + r); xx++) {
          sum += grid[yy * gw + xx]
          n++
        }
      }
      out[y * gw + x] = sum / n
    }
  }
  return out
}
