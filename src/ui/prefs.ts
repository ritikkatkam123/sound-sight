import { DEFAULT_LOOK, type Look } from '../visuals/look'

export interface Prefs {
  look: Look
  /** Onset threshold in dB; lower means more sensitive. */
  thresholdDb: number
}

const KEY = 'soundsight.prefs.v1'
export const DEFAULT_PREFS: Prefs = { look: DEFAULT_LOOK, thresholdDb: 10 }

// Browser storage can be missing or throw (private windows, blocked site data), so fall back to defaults.
export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFS
    const p = JSON.parse(raw) as Partial<Prefs>
    return { look: { ...DEFAULT_LOOK, ...p.look }, thresholdDb: p.thresholdDb ?? DEFAULT_PREFS.thresholdDb }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Not being able to remember settings is harmless.
  }
}
