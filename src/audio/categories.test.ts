import { describe, expect, it } from 'vitest'
import { categorize } from './categories'

describe('categorize', () => {
  it('maps a YAMNet label to its category', () => {
    expect(categorize([{ categoryName: 'Finger snapping', score: 0.6 }])).toEqual({ category: 'snap', score: 0.6 })
  })

  it('sums related labels so several weak votes can win', () => {
    const r = categorize([
      { categoryName: 'Speech', score: 0.3 },
      { categoryName: 'Clapping', score: 0.25 },
      { categoryName: 'Applause', score: 0.2 },
      { categoryName: 'Hands', score: 0.1 },
    ])
    expect(r.category).toBe('clap')
    expect(r.score).toBeCloseTo(0.55)
  })

  it('caps the score at 1', () => {
    const r = categorize([
      { categoryName: 'Speech', score: 0.9 },
      { categoryName: 'Conversation', score: 0.5 },
    ])
    expect(r).toEqual({ category: 'voice', score: 1 })
  })

  it('ignores labels it does not know', () => {
    expect(categorize([{ categoryName: 'Silence', score: 0.9 }])).toEqual({ category: 'other', score: 0 })
  })

  it('returns other when the best category is below the threshold', () => {
    expect(categorize([{ categoryName: 'Knock', score: 0.05 }]).category).toBe('other')
  })

  it('treats whistling and music separately from voice', () => {
    expect(categorize([{ categoryName: 'Whistling', score: 0.4 }]).category).toBe('whistle')
    expect(categorize([{ categoryName: 'Music', score: 0.4 }]).category).toBe('music')
  })
})
