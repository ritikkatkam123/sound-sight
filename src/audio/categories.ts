// Maps YAMNet's 521 AudioSet labels onto the handful of categories the visuals care about.

export type SoundCategory = 'clap' | 'snap' | 'knock' | 'beat' | 'voice' | 'whistle' | 'music' | 'other'

/** Exact YAMNet display names (see yamnet_class_map.csv). */
export const CATEGORY_LABELS: Record<Exclude<SoundCategory, 'other'>, readonly string[]> = {
  clap: ['Clapping', 'Applause', 'Hands'],
  snap: ['Finger snapping', 'Clicking'],
  knock: ['Knock', 'Tap', 'Thump, thud', 'Slap, smack', 'Whack, thwack', 'Door', 'Wood', 'Bang', 'Wood block'],
  // Beatboxing and drum hits: rhythmic and percussive, so each hit gets its own punchy effect.
  beat: ['Beatboxing', 'Percussion', 'Drum', 'Drum kit', 'Drum machine', 'Snare drum', 'Bass drum', 'Drum roll'],
  voice: [
    'Speech',
    'Child speech, kid speaking',
    'Conversation',
    'Narration, monologue',
    'Babbling',
    'Whispering',
    'Shout',
    'Yell',
    'Laughter',
    'Singing',
    'Humming',
  ],
  whistle: ['Whistling', 'Whistle'],
  music: ['Music', 'Musical instrument'],
}

/**
 * Labels specific enough to decide the category on their own. Beatboxing also scores high on
 * "Speech" and "Music", and summed together those would outvote it.
 */
const DECISIVE: ReadonlyMap<string, Exclude<SoundCategory, 'other'>> = new Map([['Beatboxing', 'beat']])

/** Continuous sounds come from the mouth or from no visible source, unlike impacts. */
export const SUSTAINED: ReadonlySet<SoundCategory> = new Set(['voice', 'whistle', 'music'])

const LABEL_TO_CATEGORY = new Map<string, Exclude<SoundCategory, 'other'>>(
  Object.entries(CATEGORY_LABELS).flatMap(([cat, labels]) =>
    labels.map((l) => [l, cat as Exclude<SoundCategory, 'other'>] as const),
  ),
)

export interface LabelScore {
  categoryName: string
  score: number
}

export interface CategoryResult {
  category: SoundCategory
  /** 0..1 */
  score: number
  /** Every recognised category's score (summed labels, capped at 1). */
  scores: Partial<Record<SoundCategory, number>>
}

/** Impact-like categories: one sound, one hit. */
const IMPULSIVE: readonly SoundCategory[] = ['clap', 'snap', 'knock', 'beat']

/**
 * YAMNet scores labels independently (several can be high at once), so a category's score is the
 * sum of its labels' scores, capped at 1. The best category wins if it reaches `minScore`.
 */
export function categorize(labels: readonly LabelScore[], minScore = 0.1): CategoryResult {
  const scores: Partial<Record<SoundCategory, number>> = {}
  for (const { categoryName, score } of labels) {
    const cat = LABEL_TO_CATEGORY.get(categoryName)
    if (cat) scores[cat] = Math.min(1, (scores[cat] ?? 0) + score)
  }
  for (const { categoryName, score } of labels) {
    const cat = DECISIVE.get(categoryName)
    if (cat && score >= minScore) return { category: cat, score: scores[cat] ?? score, scores }
  }
  let best: { category: SoundCategory; score: number } = { category: 'other', score: 0 }
  for (const [category, score] of Object.entries(scores) as [SoundCategory, number][]) {
    if (score > best.score) best = { category, score }
  }
  return best.score >= minScore ? { ...best, scores } : { category: 'other', score: best.score, scores }
}

/**
 * The category of a sound that just triggered an onset. An onset means something was *hit*, so an
 * impact category with a real score beats music or voice, even when those score higher overall:
 * YAMNet calls a drum loop or beatboxing "Music" or "Speech" first, but each hit is still a beat.
 */
export function hitCategory(result: CategoryResult, minImpulsive = 0.15): CategoryResult {
  if (IMPULSIVE.includes(result.category)) return result
  let best: CategoryResult | null = null
  for (const category of IMPULSIVE) {
    const score = result.scores[category] ?? 0
    if (score >= minImpulsive && score > (best?.score ?? 0)) best = { category, score, scores: result.scores }
  }
  return best ?? result
}
