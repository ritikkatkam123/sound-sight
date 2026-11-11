import {
  Application,
  Color,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  RenderTexture,
  Sprite,
  Text,
  Texture,
} from 'pixi.js'
import { AdvancedBloomFilter } from 'pixi-filters'
import { DEFAULT_LOOK, trailDecay, type Look } from './look'
import type { HandPose } from '../vision/hands'
import type { MouthState } from '../vision/face'

// Bone pairs for drawing a hand skeleton (MediaPipe's 21-point layout).
const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

interface Spark {
  p: Particle
  vx: number
  vy: number
  size: number
  life: number
  maxLife: number
  drag: number
  gravity: number
}

interface Ring {
  x: number
  y: number
  r: number
  vr: number
  width: number
  color: number
  alpha: number
  life: number
  maxLife: number
  /** Vertical squash: 1 = circle, <1 = flattened ellipse. */
  squash: number
  /** Optional waveform (-1..1) wrapped around the ring, displacing it by up to `amp` pixels. */
  wave?: Float32Array
  amp: number
}

interface Bolt {
  paths: { x: number; y: number }[][]
  color: number
  width: number
  life: number
  maxLife: number
}

interface Glyph {
  sprite: Sprite
  vx: number
  vy: number
  baseX: number
  sway: number
  phase: number
  life: number
  maxLife: number
}

interface Pulse {
  magnitude: number
  life: number
  maxLife: number
}

export interface SpawnOptions {
  /** Normalized video coords. */
  nx: number
  ny: number
  count: number
  color: number
  /** Pixels per second. */
  speed: [number, number]
  /** Radians; default all directions. 0 = right, -π/2 = up. */
  angle?: [number, number]
  /** Particle diameter in pixels. */
  size?: [number, number]
  /** Seconds. */
  life?: [number, number]
  /** Velocity kept per 1/60 s (0.94 = quick slow-down, 1 = none). */
  drag?: number
  /** Pixels per second² (positive = falls). */
  gravity?: number
  /** Random spawn offset in pixels. */
  jitter?: number
}

export interface RingOptions {
  nx: number
  ny: number
  color: number
  /** Start radius and growth, pixels and pixels per second. */
  radius?: number
  speed?: number
  width?: number
  alpha?: number
  life?: number
  squash?: number
  wave?: Float32Array
  /** Pixels of waveform displacement (only with `wave`). */
  amp?: number
}

export interface BoltOptions {
  nx: number
  ny: number
  color: number
  count: number
  /** Pixels. */
  length: [number, number]
  life?: number
  width?: number
}

export interface GlyphOptions {
  nx: number
  ny: number
  text: string
  color: number
  /** Font size in pixels. */
  size: number
  /** Pixels per second; negative vy rises. */
  vx?: number
  vy?: number
  /** Side-to-side sway amplitude in pixels. */
  sway?: number
  life?: number
}

/** A group of particles that can be restyled after spawning (e.g. once the sound is classified). */
export interface ParticleGroup {
  retint(color: number): void
  /** Fade the group out over roughly `seconds`. */
  fadeOut(seconds: number): void
}

const rand = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo)

/**
 * WebGL overlay drawn on top of the mirrored video.
 * Callers pass positions in normalized *video* coordinates (0..1, unmirrored),
 * and the stage maps them to screen pixels, including the mirror flip and object-fit: cover cropping.
 */
export class Stage {
  readonly app = new Application()
  private sparks: Spark[] = []
  private rings: Ring[] = []
  private video!: HTMLVideoElement
  private dot!: Texture
  private bolts: Bolt[] = []
  private glyphs: Glyph[] = []
  private flashState: (Pulse & { color: number }) | null = null
  private shakeState: Pulse | null = null
  private shakeEl: HTMLElement | null = null
  private spectrumBars: { bands: Float32Array; colors: number[]; level: number; target: number } | null = null
  private glyphTextures = new Map<string, Texture>()
  private landmarks = new Graphics()
  private ringLayer = new Graphics()
  private glyphLayer = new Container()
  /** Drawn on top of everything, never trailed or bloomed (e.g. the clap flash). */
  private overlay = new Graphics()
  private look: Look = DEFAULT_LOOK
  // Trails: each frame, the effects are rendered into a texture on top of a faded copy of the previous
  // frame's texture (ping-ponging between two render textures), and that texture is what's displayed.
  private fxRoot = new Container()
  private trailScene = new Container()
  private feedback = new Sprite()
  private display = new Sprite()
  private targets: [RenderTexture, RenderTexture] | null = null
  private bloom = new AdvancedBloomFilter({ threshold: 0.15, bloomScale: 1, brightness: 1, blur: 8, quality: 6 })
  // One batched container + one shared texture; much cheaper than a Graphics object per particle.
  private container = new ParticleContainer({
    dynamicProperties: { position: true, vertex: true, color: true },
  })

  async init(container: HTMLElement, video: HTMLVideoElement): Promise<void> {
    this.video = video
    await this.app.init({
      resizeTo: container,
      backgroundAlpha: 0,
      antialias: false,
      autoDensity: true,
      // Full retina resolution quadruples fill cost for soft particles that don't need it.
      resolution: Math.min(window.devicePixelRatio, 1.5),
    })
    this.dot = Texture.from(softDot(32))
    this.container.blendMode = 'add'
    this.ringLayer.blendMode = 'add'
    this.fxRoot.addChild(this.ringLayer, this.glyphLayer, this.container)
    this.trailScene.addChild(this.feedback, this.fxRoot)
    this.app.stage.addChild(this.landmarks, this.display, this.overlay)
    this.setLook(this.look)
    container.appendChild(this.app.canvas)
    // Shake the video and overlay together, not just the effects.
    this.shakeEl = container.parentElement
    this.app.ticker.add((t) => this.update(Math.min(t.deltaMS / 1000, 0.1)))
  }

  setLook(look: Look): void {
    this.look = look
    this.bloom.bloomScale = 0.4 + 1.6 * look.glow
    this.bloom.blur = 4 + 12 * look.glow
    this.display.filters = look.glow > 0 ? [this.bloom] : []
  }

  /** Normalized video coords → overlay pixel coords. */
  toScreen(nx: number, ny: number): { x: number; y: number } {
    const { width: sw, height: sh } = this.app.screen
    const vw = this.video.videoWidth || sw
    const vh = this.video.videoHeight || sh
    const scale = Math.max(sw / vw, sh / vh)
    const dw = vw * scale
    const dh = vh * scale
    const ox = (sw - dw) / 2
    const oy = (sh - dh) / 2
    return { x: ox + (1 - nx) * dw, y: oy + ny * dh }
  }

  /** Overlay pixel coords → normalized video coords (inverse of toScreen). */
  toVideo(x: number, y: number): { nx: number; ny: number } {
    const { width: sw, height: sh } = this.app.screen
    const vw = this.video.videoWidth || sw
    const vh = this.video.videoHeight || sh
    const scale = Math.max(sw / vw, sh / vh)
    const dw = vw * scale
    const dh = vh * scale
    const ox = (sw - dw) / 2
    const oy = (sh - dh) / 2
    return { nx: 1 - (x - ox) / dw, ny: (y - oy) / dh }
  }

  /** Visible area in normalized video coords (object-fit: cover crops the video). */
  get visibleBounds(): { left: number; right: number; top: number; bottom: number } {
    const { width: sw, height: sh } = this.app.screen
    const a = this.toVideo(sw, 0) // mirrored: screen-right is the video's left
    const b = this.toVideo(0, sh)
    return { left: a.nx, right: b.nx, top: a.ny, bottom: b.ny }
  }

  spawn(o: SpawnOptions): ParticleGroup {
    const { x, y } = this.toScreen(o.nx, o.ny)
    // Pixi 8.6 stores a *numeric* particle tint without swapping it to BGR (red/blue come out swapped);
    // passing a Color object goes through the correct conversion.
    const tint = new Color(o.color)
    const angle = o.angle ?? [0, Math.PI * 2]
    const jitter = o.jitter ?? 0
    const group: Spark[] = []
    const count = Math.max(1, Math.round(o.count * this.look.intensity))
    const sizeScale = Math.sqrt(this.look.intensity)
    for (let i = 0; i < count; i++) {
      const a = rand(angle)
      const speed = rand(o.speed)
      const size = (rand(o.size ?? [4, 12]) * sizeScale) / 32
      const p = new Particle({
        texture: this.dot,
        x: x + (Math.random() - 0.5) * jitter,
        y: y + (Math.random() - 0.5) * jitter,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: size,
        scaleY: size,
        tint,
      })
      this.container.addParticle(p)
      const maxLife = rand(o.life ?? [0.5, 1.1])
      const spark: Spark = {
        p,
        size,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: maxLife,
        maxLife,
        drag: o.drag ?? 0.94,
        gravity: o.gravity ?? 60,
      }
      this.sparks.push(spark)
      group.push(spark)
    }
    return {
      retint(color) {
        const c = new Color(color)
        for (const s of group) s.p.tint = c
      },
      fadeOut(seconds) {
        for (const s of group) {
          if (s.life <= seconds) continue
          // Keep the current alpha (life / maxLife) continuous while shortening the remaining life.
          s.maxLife = (seconds * s.maxLife) / s.life
          s.life = seconds
        }
      },
    }
  }

  ring(o: RingOptions): void {
    const { x, y } = this.toScreen(o.nx, o.ny)
    const life = o.life ?? 0.8
    this.rings.push({
      x,
      y,
      r: o.radius ?? 10,
      vr: o.speed ?? 300,
      width: o.width ?? 3,
      color: o.color,
      alpha: o.alpha ?? 0.9,
      life,
      maxLife: life,
      squash: o.squash ?? 1,
      wave: o.wave,
      amp: o.amp ?? 0,
    })
  }

  /** Jagged, branching lightning bolts radiating from a point. */
  bolt(o: BoltOptions): void {
    const { x, y } = this.toScreen(o.nx, o.ny)
    const paths: { x: number; y: number }[][] = []
    for (let i = 0; i < o.count; i++) {
      const a = (i / o.count) * Math.PI * 2 + Math.random() * 0.8
      const len = rand(o.length)
      const end = { x: x + Math.cos(a) * len, y: y + Math.sin(a) * len }
      const main = jagged({ x, y }, end, len * 0.25, 4)
      paths.push(main)
      // A short side branch off the middle of each bolt.
      const mid = main[Math.floor(main.length / 2)]
      const ba = a + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5)
      paths.push(jagged(mid, { x: mid.x + Math.cos(ba) * len * 0.4, y: mid.y + Math.sin(ba) * len * 0.4 }, len * 0.12, 3))
    }
    const life = o.life ?? 0.25
    this.bolts.push({ paths, color: o.color, width: o.width ?? 2.5, life, maxLife: life })
  }

  /** A floating text glyph (e.g. a music note). */
  glyph(o: GlyphOptions): void {
    let tex = this.glyphTextures.get(o.text)
    if (!tex) {
      const text = new Text({ text: o.text, style: { fontSize: 96, fill: 0xffffff, fontFamily: 'system-ui, sans-serif' } })
      tex = this.app.renderer.generateTexture(text)
      text.destroy()
      this.glyphTextures.set(o.text, tex)
    }
    const { x, y } = this.toScreen(o.nx, o.ny)
    const sprite = new Sprite({ texture: tex, anchor: 0.5, tint: o.color })
    sprite.scale.set(o.size / 96)
    sprite.position.set(x, y)
    this.glyphLayer.addChild(sprite)
    const life = o.life ?? 1.6
    this.glyphs.push({ sprite, vx: o.vx ?? 0, vy: o.vy ?? -80, baseX: x, sway: o.sway ?? 0, phase: Math.random() * 6.28, life, maxLife: life })
  }

  /** Brief full-screen tint. */
  flash(color: number, alpha = 0.2, life = 0.15): void {
    this.flashState = { color, magnitude: alpha, life, maxLife: life }
  }

  /** Shake the camera view by up to `pixels`, decaying over `life` seconds. */
  shake(pixels: number, life = 0.25): void {
    if (!this.look.shake) return
    this.shakeState = { magnitude: Math.max(pixels, this.shakeState?.magnitude ?? 0), life, maxLife: life }
  }

  /**
   * Equalizer bars along the bottom. Pass live 0..1 bands every frame while active,
   * or null to let the bars fade away.
   */
  setSpectrum(bands: Float32Array | null, colors: number[] = []): void {
    if (!bands) {
      if (this.spectrumBars) this.spectrumBars.target = 0
      return
    }
    const cur = this.spectrumBars
    if (!cur || cur.bands.length !== bands.length) {
      this.spectrumBars = { bands: Float32Array.from(bands), colors, level: 0, target: 1 }
      return
    }
    // Fast attack, slow release, like a VU meter.
    for (let i = 0; i < bands.length; i++) cur.bands[i] = bands[i] > cur.bands[i] ? bands[i] : cur.bands[i] * 0.88 + bands[i] * 0.12
    cur.colors = colors
    cur.target = 1
  }

  /** Classic radial burst. */
  burst(nx: number, ny: number, intensity = 1, color = 0x7cf7ff): ParticleGroup {
    return this.spawn({
      nx,
      ny,
      color,
      count: Math.round(24 + 40 * intensity),
      speed: [150 * (0.6 + intensity), 500 * (0.6 + intensity)],
    })
  }

  /** Debug overlay: hand skeletons, palm/fingertip markers and the mouth. Pass nulls to clear. */
  drawLandmarks(hands: HandPose[] | null, mouth: MouthState | null): void {
    const g = this.landmarks.clear()
    for (const hand of hands ?? []) {
      const pts = hand.points.map((p) => this.toScreen(p.x, p.y))
      for (const [a, b] of HAND_BONES) g.moveTo(pts[a].x, pts[a].y).lineTo(pts[b].x, pts[b].y)
      g.stroke({ width: 2, color: 0xffffff, alpha: 0.5 })
      for (const p of pts) g.circle(p.x, p.y, 3)
      g.fill({ color: 0xffffff, alpha: 0.8 })
      const palm = this.toScreen(hand.palm.x, hand.palm.y)
      const tips = this.toScreen(hand.tips.x, hand.tips.y)
      g.circle(palm.x, palm.y, 10).stroke({ width: 2, color: 0x7cf7ff })
      g.circle(tips.x, tips.y, 6).fill({ color: 0xffc94d })
    }
    if (mouth) {
      const m = this.toScreen(mouth.center.x, mouth.center.y)
      g.ellipse(m.x, m.y, 22, 6 + 40 * mouth.open).stroke({ width: 2, color: 0xff7ad9 })
    }
  }

  get particleCount(): number {
    return this.sparks.length
  }

  private update(dt: number): void {
    const step = dt * 60
    let removed = false
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]
      s.life -= dt
      if (s.life <= 0) {
        // sparks[] and particleChildren[] are appended together, so indices line up.
        this.container.particleChildren.splice(i, 1)
        this.sparks.splice(i, 1)
        removed = true
        continue
      }
      const drag = s.drag ** step
      s.vx *= drag
      s.vy = s.vy * drag + s.gravity * dt
      s.p.x += s.vx * dt
      s.p.y += s.vy * dt
      const k = s.life / s.maxLife
      s.p.alpha = k
      s.p.scaleX = s.p.scaleY = s.size * (0.5 + k)
    }
    if (removed) this.container.update()

    const g = this.ringLayer.clear()
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.life -= dt
      if (r.life <= 0) {
        this.rings.splice(i, 1)
        continue
      }
      r.r += r.vr * dt
      const k = r.life / r.maxLife
      const stroke = { width: r.width * (0.4 + k), color: r.color, alpha: r.alpha * k }
      if (!r.wave) {
        g.ellipse(r.x, r.y, r.r, r.r * r.squash).stroke(stroke)
        continue
      }
      const n = r.wave.length
      for (let j = 0; j <= n; j++) {
        const a = (j / n) * Math.PI * 2
        const rr = r.r + r.amp * k * r.wave[j % n]
        const px = r.x + Math.cos(a) * rr
        const py = r.y + Math.sin(a) * rr * r.squash
        if (j === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.stroke(stroke)
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]
      b.life -= dt
      if (b.life <= 0) {
        this.bolts.splice(i, 1)
        continue
      }
      // Flicker: lightning shouldn't fade smoothly.
      const alpha = (b.life / b.maxLife) * (0.5 + 0.5 * Math.random())
      for (const path of b.paths) {
        g.moveTo(path[0].x, path[0].y)
        for (let j = 1; j < path.length; j++) g.lineTo(path[j].x, path[j].y)
      }
      g.stroke({ width: b.width * 3, color: b.color, alpha: alpha * 0.3 }) // glow
      for (const path of b.paths) {
        g.moveTo(path[0].x, path[0].y)
        for (let j = 1; j < path.length; j++) g.lineTo(path[j].x, path[j].y)
      }
      g.stroke({ width: b.width, color: 0xffffff, alpha })
    }

    for (let i = this.glyphs.length - 1; i >= 0; i--) {
      const gl = this.glyphs[i]
      gl.life -= dt
      if (gl.life <= 0) {
        gl.sprite.destroy()
        this.glyphs.splice(i, 1)
        continue
      }
      const age = gl.maxLife - gl.life
      gl.baseX += gl.vx * dt
      gl.sprite.x = gl.baseX + Math.sin(age * 4 + gl.phase) * gl.sway
      gl.sprite.y += gl.vy * dt
      gl.sprite.rotation = Math.sin(age * 4 + gl.phase) * 0.25
      const k = gl.life / gl.maxLife
      gl.sprite.alpha = Math.min(1, k * 2, age * 8)
    }

    const { width: sw, height: sh } = this.app.screen
    const bars = this.spectrumBars
    if (bars) {
      bars.level += (bars.target - bars.level) * Math.min(1, dt * 6)
      if (bars.target === 0 && bars.level < 0.01) this.spectrumBars = null
      else {
        const n = bars.bands.length
        const w = sw / n
        for (let j = 0; j < n; j++) {
          const h = Math.max(2, bars.bands[j] * sh * 0.28 * bars.level)
          g.roundRect(j * w + w * 0.15, sh - h, w * 0.7, h, Math.min(6, w * 0.3)).fill({
            color: bars.colors[j] ?? 0xffffff,
            alpha: 0.75 * bars.level,
          })
        }
      }
    }

    const f = this.flashState
    if (f) {
      f.life -= dt
      if (f.life <= 0) this.flashState = null
    }
    const o = this.overlay.clear()
    if (this.flashState) {
      const fl = this.flashState
      o.rect(0, 0, sw, sh).fill({ color: fl.color, alpha: fl.magnitude * (fl.life / fl.maxLife) })
    }

    const sk = this.shakeState
    if (sk && this.shakeEl) {
      sk.life -= dt
      if (sk.life <= 0) {
        this.shakeState = null
        this.shakeEl.style.transform = ''
      } else {
        const m = sk.magnitude * (sk.life / sk.maxLife)
        this.shakeEl.style.transform = `translate(${(Math.random() - 0.5) * 2 * m}px, ${(Math.random() - 0.5) * 2 * m}px)`
      }
    }

    this.renderTrails()
  }

  private renderTrails(): void {
    const r = this.app.renderer
    const { width, height } = this.app.screen
    if (!this.targets || this.targets[0].width !== width || this.targets[0].height !== height) {
      this.targets?.forEach((t) => t.destroy(true))
      const make = () => RenderTexture.create({ width, height, resolution: r.resolution })
      this.targets = [make(), make()]
    }
    const [prev, next] = this.targets
    this.feedback.texture = prev
    this.feedback.alpha = trailDecay(this.look.trails)
    this.feedback.visible = this.feedback.alpha > 0
    r.render({ container: this.trailScene, target: next, clear: true, clearColor: [0, 0, 0, 0] })
    this.display.texture = next
    this.targets = [next, prev]
  }

  destroy(): void {
    if (this.shakeEl) this.shakeEl.style.transform = ''
    for (const t of this.glyphTextures.values()) t.destroy(true)
    this.targets?.forEach((t) => t.destroy(true))
    this.trailScene.destroy({ children: true })
    this.app.destroy(true, { children: true })
  }
}

/** Soft radial glow, drawn once and shared by every particle. */
function softDot(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const r = size / 2
  const g = ctx.createRadialGradient(r, r, 0, r, r, r)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return c
}

/** Midpoint-displacement line: recursively bends the midpoint sideways for a jagged look. */
function jagged(a: { x: number; y: number }, b: { x: number; y: number }, offset: number, depth: number): { x: number; y: number }[] {
  if (depth === 0) return [a, b]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const shift = (Math.random() - 0.5) * 2 * offset
  const mid = { x: (a.x + b.x) / 2 - (dy / len) * shift, y: (a.y + b.y) / 2 + (dx / len) * shift }
  return [...jagged(a, mid, offset / 2, depth - 1), ...jagged(mid, b, offset / 2, depth - 1).slice(1)]
}
