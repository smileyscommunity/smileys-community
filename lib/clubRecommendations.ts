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
  travel:     ['Travel', 'Outdoor'],
}

// English is the community's default language, not a preference: 370 of the
// ~1,400 members list it, so matching on it would put the English club in
// almost every lineup and push out the club that actually says something
// about this member. Every other language is a real signal — someone who
// lists Persian and lands in a city with a Persian club should see it.
const LINGUA_FRANCA = new Set(['english'])

/**
 * "Your lineup" club picks for a member's first weeks: their registration
 * interests mapped to club categories, the languages they speak matched to
 * the Language clubs, and the city's Newcomers club boosted for
 * self-declared new-in-towners. Only clubs the member hasn't joined;
 * zero-score clubs never show (an empty lineup beats a random one).
 * getClubs handles the city scoping + showGlobalClubs rules.
 *
 * Languages matter more than they look. A city that opts into global clubs
 * gains ~32 of them and most are Language or Culture clubs, so without this
 * a Persian speaker in Antalya was recommended clubs by hobby while the
 * Persian club sat below at zero local members — the club could only look
 * unwanted because nobody was shown it.
 */
export async function recommendedClubsFor(opts: {
  cityId: string
  interests: string[]
  languages?: string[]
  newInTown: boolean
  excludeClubIds: string[]
  limit?: number
}): Promise<Club[]> {
  const { cityId, interests, languages = [], newInTown, excludeClubIds, limit = 4 } = opts
  // Languages alone are enough to build a lineup, so they join the guard —
  // a member who listed only languages used to get nothing at all.
  const spoken = languages.map(l => l.trim().toLowerCase()).filter(l => l && !LINGUA_FRANCA.has(l))
  if (interests.length === 0 && spoken.length === 0 && !newInTown) return []

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

  // Matched on both name and slug: the Chinese club's slug is 'mandarin', so a
  // member who wrote either word finds it.
  const spokenSet = new Set(spoken)
  const speaksFor = (c: Club) =>
    c.category === 'Language' && (spokenSet.has(c.name.trim().toLowerCase()) || spokenSet.has(c.slug))

  return all
    .filter(c => !excluded.has(c.id))
    .map(c => ({
      c,
      score:
        (newInTown && c.category === 'Newcomers' ? 4 : 0) +
        // Worth an interest match: "I speak this" is as strong a statement
        // about who someone wants to meet as "I like this".
        (speaksFor(c) ? 3 : 0) +
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
