// Maps YAMNet's 521 AudioSet labels onto the handful of categories the visuals care about.

export type SoundCategory = 'clap' | 'snap' | 'knock' | 'voice' | 'whistle' | 'music' | 'other'

/** Exact YAMNet display names (see yamnet_class_map.csv). */
export const CATEGORY_LABELS: Record<Exclude<SoundCategory, 'other'>, readonly string[]> = {
  clap: ['Clapping', 'Applause', 'Hands'],
  snap: ['Finger snapping', 'Clicking'],
  knock: ['Knock', 'Tap', 'Thump, thud', 'Slap, smack', 'Whack, thwack', 'Door', 'Wood', 'Bang', 'Wood block'],
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
}

/**
 * YAMNet scores labels independently (several can be high at once), so a category's score is the
 * sum of its labels' scores, capped at 1. The best category wins if it reaches `minScore`.
 */
export function categorize(labels: readonly LabelScore[], minScore = 0.1): CategoryResult {
  const totals = new Map<SoundCategory, number>()
  for (const { categoryName, score } of labels) {
    const cat = LABEL_TO_CATEGORY.get(categoryName)
    if (cat) totals.set(cat, (totals.get(cat) ?? 0) + score)
  }
  let best: CategoryResult = { category: 'other', score: 0 }
  for (const [category, total] of totals) {
    const score = Math.min(1, total)
    if (score > best.score) best = { category, score }
  }
  return best.score >= minScore ? best : { category: 'other', score: best.score }
}
