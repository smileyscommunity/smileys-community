// Why a local might say hi to a visitor.
//
// The /visiting cards already carried the raw facts — the visitor's languages,
// the neighbourhood they're staying in — but only interests were ever compared
// against the viewer. So the card would show "🗣️ Arabic" to an Arabic speaker
// and "📍 Kadıköy" to someone who lives in Kadıköy without ever telling either
// of them it was a match, which is the whole reason those fields are collected.
//
// Pure and client-safe (no imports): the card renders it, and the tests read
// the same rules the card applies.

export interface MatchProfile {
  interests:    string[]
  languages:    string[]
  neighborhood: string | null
}

export interface SharedSignals {
  interests:        string[]
  languages:        string[]
  sameNeighborhood: boolean
}

/** Both sides are member-typed free text: "english", "English " and "ENGLISH" are one language. */
const norm = (v: string) => v.trim().toLowerCase()

/**
 * Values present on both sides, in the TARGET's spelling — the visitor wrote
 * "Türkçe", and echoing the viewer's "turkish" back at them would read as a
 * different word. Deduplicated case-insensitively, then capped: a card is a
 * glance, and eight chips is not a glance.
 */
function overlap(viewer: string[], target: string[], cap: number): string[] {
  const want = new Set(viewer.map(norm).filter(Boolean))
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of target) {
    const key = norm(value)
    if (!key || !want.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(value.trim())
    if (out.length === cap) break
  }
  return out
}

export const MAX_SHARED_INTERESTS = 3
export const MAX_SHARED_LANGUAGES = 2

/**
 * What this viewer and this visitor have in common. A logged-out viewer (empty
 * profile) matches nothing, which is correct: signals like "you both speak
 * Arabic" are meaningless without a "you".
 */
export function sharedSignals(viewer: MatchProfile, target: MatchProfile): SharedSignals {
  return {
    interests: overlap(viewer.interests, target.interests, MAX_SHARED_INTERESTS),
    languages: overlap(viewer.languages, target.languages, MAX_SHARED_LANGUAGES),
    // A null on either side is "unknown", never a match — two members who both
    // left it blank have not been shown to live anywhere near each other.
    sameNeighborhood: !!(viewer.neighborhood && target.neighborhood
      && norm(viewer.neighborhood) === norm(target.neighborhood)),
  }
}
