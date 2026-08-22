import { getClubs } from './db'
import type { Club } from './data'

// Canonical interest slugs (lib/profileOptions) → the club categories that
// serve them. Categories are the stable axis here — clubs come and go, but
// every club carries one — so the mapping survives new clubs without edits.
// 'games' has no category of its own; games clubs (Chess, Trivia, Social
// Games) all file under Social in prod.
const INTEREST_TO_CATEGORIES: Record<string, string[]> = {
  sailing:    ['Sports', 'Outdoor', 'Travel'],
  dining:     ['Food & Drinks'],
  social:     ['Social', 'Nightlife'],
  wellness:   ['Wellness'],
  networking: ['Business', 'Networking', 'Technology'],
  languages:  ['Language'],
  games:      ['Social'],
  outdoor:    ['Outdoor', 'Sports', 'Travel'],
  creative:   ['Creative', 'Culture'],
}

/**
 * "Your lineup" club picks for a member's first weeks: their registration
 * interests mapped to club categories, with the city's Newcomers club
 * boosted for self-declared new-in-towners. Only clubs the member hasn't
 * joined; zero-score clubs never show (an empty lineup beats a random one).
 * getClubs handles the city scoping + showGlobalClubs rules.
 */
export async function recommendedClubsFor(opts: {
  cityId: string
  interests: string[]
  newInTown: boolean
  excludeClubIds: string[]
  limit?: number
}): Promise<Club[]> {
  const { cityId, interests, newInTown, excludeClubIds, limit = 4 } = opts
  if (interests.length === 0 && !newInTown) return []

  const all = await getClubs(cityId)
  const excluded = new Set(excludeClubIds)

  // Two interests pointing at the same category ("sailing" + "outdoor" →
  // Sports) compound, which is the right signal — that member really wants
  // the sporty clubs first.
  const wantedCategories = new Map<string, number>()
  for (const i of interests) {
    for (const cat of INTEREST_TO_CATEGORIES[i] ?? []) {
      wantedCategories.set(cat, (wantedCategories.get(cat) ?? 0) + 1)
    }
  }

  return all
    .filter(c => !excluded.has(c.id))
    .map(c => ({
      c,
      score:
        (newInTown && c.category === 'Newcomers' ? 4 : 0) +
        (wantedCategories.get(c.category) ?? 0) * 3 +
        // Liveliness tiebreak, capped so a giant club can't outrank a
        // genuine interest match.
        Math.min((c.memberCount ?? 0) / 100, 2),
    }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.c)
}
