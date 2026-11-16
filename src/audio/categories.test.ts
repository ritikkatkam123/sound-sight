import { describe, expect, it } from 'vitest'
import { categorize, hitCategory } from './categories'

describe('categorize', () => {
  it('maps a YAMNet label to its category', () => {
    expect(categorize([{ categoryName: 'Finger snapping', score: 0.6 }])).toMatchObject({ category: 'snap', score: 0.6 })
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
    expect(r).toMatchObject({ category: 'voice', score: 1 })
  })

  it('ignores labels it does not know', () => {
    expect(categorize([{ categoryName: 'Silence', score: 0.9 }])).toMatchObject({ category: 'other', score: 0 })
  })

  it('returns other when the best category is below the threshold', () => {
    expect(categorize([{ categoryName: 'Knock', score: 0.05 }]).category).toBe('other')
  })

  it('recognizes beatboxing even when speech and music outscore it together', () => {
    const r = categorize([
      { categoryName: 'Speech', score: 0.35 },
      { categoryName: 'Music', score: 0.3 },
      { categoryName: 'Beatboxing', score: 0.25 },
      { categoryName: 'Conversation', score: 0.1 },
    ])
    expect(r.category).toBe('beat')
    expect(r.score).toBeCloseTo(0.25)
  })

  it('maps drum hits to beat', () => {
    expect(categorize([{ categoryName: 'Snare drum', score: 0.3 }, { categoryName: 'Drum', score: 0.2 }])).toMatchObject({
      category: 'beat',
      score: 0.5,
    })
  })

  it('ignores a faint beatboxing score', () => {
    expect(categorize([{ categoryName: 'Speech', score: 0.6 }, { categoryName: 'Beatboxing', score: 0.05 }]).category).toBe('voice')
  })

  it('turns a music-labelled hit into a beat when drums are in it too', () => {
    const r = categorize([
      { categoryName: 'Music', score: 0.8 },
      { categoryName: 'Musical instrument', score: 0.3 },
      { categoryName: 'Drum', score: 0.12 },
      { categoryName: 'Percussion', score: 0.1 },
    ])
    expect(r.category).toBe('music')
    expect(hitCategory(r)).toMatchObject({ category: 'beat', score: 0.22 })
  })

  it('leaves a hit as voice when no impact category scores', () => {
    const r = categorize([{ categoryName: 'Speech', score: 0.8 }, { categoryName: 'Tap', score: 0.05 }])
    expect(hitCategory(r).category).toBe('voice')
  })

  it('keeps an impact category as it is', () => {
    const r = categorize([{ categoryName: 'Clapping', score: 0.5 }, { categoryName: 'Drum', score: 0.3 }])
    expect(hitCategory(r).category).toBe('clap')
  })

  it('treats whistling and music separately from voice', () => {
    expect(categorize([{ categoryName: 'Whistling', score: 0.4 }]).category).toBe('whistle')
    expect(categorize([{ categoryName: 'Music', score: 0.4 }]).category).toBe('music')
  })
})
