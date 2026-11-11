import { describe, expect, it } from 'vitest'
import { RingBuffer } from './ringBuffer'

const seq = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i)

describe('RingBuffer', () => {
  it('returns what was pushed, in order, before it fills', () => {
    const r = new RingBuffer(10)
    r.push(seq(0, 4))
    expect(r.length).toBe(4)
    expect([...r.latest(10)]).toEqual([0, 1, 2, 3])
  })

  it('keeps only the newest samples after wrapping', () => {
    const r = new RingBuffer(5)
    r.push(seq(0, 3))
    r.push(seq(3, 4)) // 0..6, capacity 5 → 2..6
    expect([...r.latest(5)]).toEqual([2, 3, 4, 5, 6])
    expect([...r.latest(2)]).toEqual([5, 6])
  })

  it('handles a chunk larger than the capacity', () => {
    const r = new RingBuffer(4)
    r.push(seq(0, 10))
    expect([...r.latest(4)]).toEqual([6, 7, 8, 9])
  })

  it('returns a copy, not a view', () => {
    const r = new RingBuffer(4)
    r.push(seq(0, 4))
    const out = r.latest(4)
    r.push(seq(100, 4))
    expect([...out]).toEqual([0, 1, 2, 3])
  })
})
