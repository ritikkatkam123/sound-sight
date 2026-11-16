import { Particle, ParticleContainer, type Texture } from 'pixi.js'
import { contour, frontIntensity, latticeDims, sampleDepth, waveDistance, type DepthMap } from '../depth/depthMath'

/** What the depth layer shows: nothing, LiDAR-style waves on each sound, or a permanent point cloud. */
export type DepthMode = 'off' | 'waves' | 'cloud'

/** Target gap between dots in CSS pixels, and a cap so huge screens stay cheap. */
const SPACING = 11
const MAX_DOTS = 7000
/** Wavefront speed in scene units (≈ screen heights) per second, and how long a wave lasts. */
const WAVE_SPEED = 1.15
const WAVE_LIFE = 1.7
const MAX_WAVES = 4

interface Wave {
  u: number
  v: number
  /** Depth at the origin, so the wave spreads from the right layer of the scene. */
  z: number
  rgb: [number, number, number]
  age: number
}

/** A wave that can be restyled after it starts (once the sound is classified). */
export interface ScanWave {
  retint(color: number): void
}

const rgbOf = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255]

// Point-cloud colours, far → near.
const FAR = rgbOf(0x1d2bff)
const MID = rgbOf(0x7cf7ff)
const NEAR = rgbOf(0xffffff)

/**
 * A lattice of dots over the screen that samples the depth map. Dots are dark until a scan wave
 * passes over them (waves mode) or always show the scene's depth (cloud mode). All dots live in one
 * ParticleContainer, and their colours are written straight into the packed colour field each frame.
 */
export class DepthField {
  readonly container = new ParticleContainer({
    dynamicProperties: { position: false, vertex: true, color: true },
  })
  private mode: DepthMode = 'off'
  private waves: Wave[] = []
  private dots: Particle[] = []
  /** Normalized video coords of each dot, and the depth under it. */
  private us = new Float32Array(0)
  private vs = new Float32Array(0)
  private zs = new Float32Array(0)
  private map: DepthMap | null = null
  private mapVersion = -1
  private sampledVersion = -2
  private layoutKey = ''
  private baseScale = 0.2
  private time = 0
  private readonly dot: Texture

  constructor(dot: Texture) {
    this.dot = dot
    this.container.blendMode = 'add'
    this.container.visible = false
  }

  setMode(mode: DepthMode): void {
    this.mode = mode
  }

  setMap(map: DepthMap | null, version: number): void {
    this.map = map
    this.mapVersion = map ? version : -1
  }

  /** Depth (0..1, 1 = near) at normalized video coords, or null without a depth map. */
  depthAt(u: number, v: number): number | null {
    return this.map ? sampleDepth(this.map, u, v) : null
  }

  scanWave(u: number, v: number, color: number): ScanWave {
    const wave: Wave = { u, v, z: this.depthAt(u, v) ?? 0.5, rgb: rgbOf(color), age: 0 }
    this.waves.push(wave)
    if (this.waves.length > MAX_WAVES) this.waves.shift()
    return {
      retint(c) {
        wave.rgb = rgbOf(c)
      },
    }
  }

  /**
   * Lays the dots out over the screen. `toVideo` maps screen pixels to normalized video coords
   * (handles the mirror and object-fit cropping).
   */
  layout(width: number, height: number, aspectKey: string, toVideo: (x: number, y: number) => { nx: number; ny: number }): void {
    const key = `${width}x${height}:${aspectKey}`
    if (key === this.layoutKey) return
    this.layoutKey = key
    const { cols, rows, spacing } = latticeDims(width, height, SPACING, MAX_DOTS)
    const n = cols * rows
    this.container.removeParticles()
    this.dots = []
    this.us = new Float32Array(n)
    this.vs = new Float32Array(n)
    this.zs = new Float32Array(n)
    this.baseScale = (spacing * 0.55) / 32 // the shared dot texture is 32 px
    const offX = (width - (cols - 1) * spacing) / 2
    const offY = (height - (rows - 1) * spacing) / 2
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const x = offX + c * spacing
        const y = offY + r * spacing
        const { nx, ny } = toVideo(x, y)
        this.us[i] = nx
        this.vs[i] = ny
        const p = new Particle({ texture: this.dot, x, y, anchorX: 0.5, anchorY: 0.5, scaleX: this.baseScale, scaleY: this.baseScale })
        p.color = 0
        this.dots.push(p)
        this.container.addParticle(p)
      }
    }
    this.sampledVersion = -2
    this.container.update()
  }

  get active(): boolean {
    return this.mode === 'cloud' || this.waves.length > 0
  }

  /** `aspect` is the video's width ÷ height. */
  update(dt: number, aspect: number): void {
    this.time += dt
    for (let i = this.waves.length - 1; i >= 0; i--) {
      this.waves[i].age += dt
      if (this.waves[i].age > WAVE_LIFE) this.waves.splice(i, 1)
    }
    const visible = this.mode !== 'off' && this.active && this.dots.length > 0
    this.container.visible = visible
    if (!visible) return

    if (this.sampledVersion !== this.mapVersion) {
      this.sampledVersion = this.mapVersion
      const map = this.map
      for (let i = 0; i < this.zs.length; i++) this.zs[i] = map ? sampleDepth(map, this.us[i], this.vs[i]) : 0.5
    }

    const cloud = this.mode === 'cloud'
    // A slow horizontal scan line sweeping down the point cloud, like a LiDAR head.
    const sweep = ((this.time * 0.22) % 1.3) - 0.15
    const waves = this.waves.map((w) => ({
      w,
      radius: w.age * WAVE_SPEED,
      fade: 1 - (w.age / WAVE_LIFE) ** 2,
    }))

    for (let i = 0; i < this.dots.length; i++) {
      const z = this.zs[i]
      const u = this.us[i]
      const v = this.vs[i]
      const lines = contour(z)
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      if (cloud) {
        const scan = Math.exp(-(((v - sweep) / 0.03) ** 2))
        const k = 0.08 + 0.6 * z * z + 0.2 * z + 0.25 * lines + 0.6 * scan
        const [c0, c1, t] = z < 0.5 ? [FAR, MID, z * 2] : [MID, NEAR, (z - 0.5) * 2]
        r += (c0[0] + (c1[0] - c0[0]) * t) * k
        g += (c0[1] + (c1[1] - c0[1]) * t) * k
        b += (c0[2] + (c1[2] - c0[2]) * t) * k
        a += k
      }

      for (const { w, radius, fade } of waves) {
        const d = waveDistance(u - w.u, v - w.v, z - w.z, aspect)
        // Waves are drawn over the live camera image, so they need to be bright to read.
        const k = 1.8 * frontIntensity(d, radius, 0.06, 0.3) * fade * (0.6 + 0.4 * lines)
        if (k < 0.01) continue
        r += w.rgb[0] * k
        g += w.rgb[1] * k
        b += w.rgb[2] * k
        a += k
      }

      const p = this.dots[i]
      if (a < 0.01) {
        p.color = 0
        continue
      }
      const alpha = a > 1 ? 1 : a
      // Colour is the weighted average; brightness comes from alpha (additive blending).
      const R = Math.min(255, r / a) | 0
      const G = Math.min(255, g / a) | 0
      const B = Math.min(255, b / a) | 0
      // Packed as Pixi stores it: BGR in the low 24 bits, alpha in the top 8.
      p.color = (B << 16) + (G << 8) + R + (((alpha * 255) | 0) << 24)
      const s = this.baseScale * (0.6 + 0.9 * z) * (0.7 + 0.9 * Math.min(a, 1.6))
      p.scaleX = p.scaleY = s
    }
  }

  clear(): void {
    this.waves = []
  }
}
