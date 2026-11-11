import { describe, expect, it } from 'vitest'
import { localizeHands } from './handLocalize'
import type { HandFrame, HandPose, Pt } from '../vision/hands'

const ASPECT = 16 / 9
const SIZE = 0.1 // hand size in frame heights

/** Minimal pose: only palm, tips and size matter to the localizer. */
function hand(palm: Pt, tips: Pt = { x: palm.x, y: palm.y - 0.1 }): HandPose {
  return { points: [], palm, tips, size: SIZE }
}

/** Frames every 33 ms ending at the onset (t = 1000). */
function frames(...poses: HandPose[][]): HandFrame[] {
  const start = 1000 - (poses.length - 1) * 33
  return poses.map((hands, i) => ({ t: start + i * 33, hands }))
}

/** Two palms approaching each other horizontally, ending `endGap` apart (in x units). */
function clapFrames(cx: number, cy: number, startGap: number, endGap: number, n = 6): HandFrame[] {
  const poses: HandPose[][] = []
  for (let i = 0; i < n; i++) {
    const gap = startGap + ((endGap - startGap) * i) / (n - 1)
    poses.push([hand({ x: cx - gap / 2, y: cy }), hand({ x: cx + gap / 2, y: cy })])
  }
  return frames(...poses)
}

describe('localizeHands', () => {
  it('returns null with no hands', () => {
    expect(localizeHands(1000, frames([], [], []), { aspect: ASPECT })).toBeNull()
  })

  it('places a clap between the palms at their closest', () => {
    const r = localizeHands(1000, clapFrames(0.3, 0.6, 0.3, 0.03), { aspect: ASPECT })
    expect(r?.source).toBe('clap')
    expect(r?.x).toBeCloseTo(0.3, 2)
    expect(r?.y).toBeCloseTo(0.6, 2)
    expect(r!.confidence).toBeGreaterThan(0.5)
  })

  it('still detects a clap when the tracker merges the hands at contact', () => {
    const h = clapFrames(0.5, 0.5, 0.3, 0.05)
    h.push({ t: 1030, hands: [hand({ x: 0.5, y: 0.5 })] })
    expect(localizeHands(1000, h, { aspect: ASPECT })?.source).toBe('clap')
  })

  it('does not call it a clap when the hands are just held together', () => {
    const still = clapFrames(0.5, 0.5, 0.04, 0.04)
    expect(localizeHands(1000, still, { aspect: ASPECT })?.source).not.toBe('clap')
  })

  it('does not call it a clap when the hands stay far apart', () => {
    expect(localizeHands(1000, clapFrames(0.5, 0.5, 0.8, 0.6), { aspect: ASPECT })?.source).not.toBe('clap')
  })

  it('places a snap at the fingertips of the hand that moved', () => {
    const still = hand({ x: 0.2, y: 0.5 })
    const snapPalm = { x: 0.7, y: 0.4 }
    const h = frames(
      [still, hand(snapPalm, { x: 0.7, y: 0.3 })],
      [still, hand(snapPalm, { x: 0.7, y: 0.3 })],
      [still, hand(snapPalm, { x: 0.72, y: 0.34 })], // fingers flick
    )
    const r = localizeHands(1000, h, { aspect: ASPECT })
    expect(r?.source).toBe('hand')
    expect(r?.x).toBeCloseTo(0.72, 2)
    expect(r?.y).toBeCloseTo(0.34, 2)
  })

  it('returns null when hands are visible but still', () => {
    const h = frames([hand({ x: 0.3, y: 0.5 })], [hand({ x: 0.3, y: 0.5 })], [hand({ x: 0.3, y: 0.5 })])
    expect(localizeHands(1000, h, { aspect: ASPECT })).toBeNull()
  })

  it('ignores movement long before the onset', () => {
    const h: HandFrame[] = [
      { t: 500, hands: [hand({ x: 0.3, y: 0.5 })] },
      { t: 533, hands: [hand({ x: 0.6, y: 0.5 })] }, // big jump, but 470 ms early
      { t: 966, hands: [hand({ x: 0.6, y: 0.5 })] },
      { t: 1000, hands: [hand({ x: 0.6, y: 0.5 })] },
    ]
    expect(localizeHands(1000, h, { aspect: ASPECT })).toBeNull()
  })
})
