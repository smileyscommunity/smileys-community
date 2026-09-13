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
// Nationality → the Culture club for that part of the world, keyed on the
// exact strings lib/countries.ts offers in the apply form. Only the 108
// values members have actually chosen are listed: an unmapped nationality
// simply scores nothing, which is the right failure — no recommendation
// beats a wrong one.
//
// These groupings are judgement, not fact, and reasonable people place some
// of these differently. The calls worth knowing about:
//   · Turkey is deliberately absent. It is 756 of ~1,760 members, it has no
//     club of its own, and every regional club it could go in (Middle
//     Eastern, Mediterranean, Balkan, Eastern European) is contested enough
//     that picking one for 43% of the community by default is not a call a
//     mapping table should make. Turkish speakers already reach the Turkish
//     Language club through `languages`.
//   · Greece and Cyprus sit in Mediterranean rather than Balkan; Bulgaria
//     sits in Balkan rather than Eastern European.
//   · Sudan is North African (UN grouping), Afghanistan is South Asian,
//     Azerbaijan is Central Asian on Turkic grounds, Mongolia is East Asian.
//   · Georgia, Cameroon, Gabon, Congo (Kinshasa) and Trinidad and Tobago are
//     left out: the Caucasus, Central Africa and the Caribbean have no club,
//     and forcing them into a neighbouring one would be worse than silence.
// Edit freely — it is data, and nothing else depends on its shape.
const NATIONALITY_TO_CLUB: Record<string, string> = {
  // Americas
  'United States': 'north-american-culture', 'Canada': 'north-american-culture',
  'Mexico': 'latin-american-culture', 'Brazil': 'latin-american-culture',
  'Argentina': 'latin-american-culture', 'Colombia': 'latin-american-culture',
  'Venezuela': 'latin-american-culture', 'Chile': 'latin-american-culture',
  'Bolivia': 'latin-american-culture', 'Ecuador': 'latin-american-culture',
  'Panama': 'latin-american-culture', 'Cuba': 'latin-american-culture',
  // Europe
  'United Kingdom': 'western-european-culture', 'Ireland': 'western-european-culture',
  'France': 'western-european-culture', 'Germany': 'western-european-culture',
  'Netherlands': 'western-european-culture', 'Belgium': 'western-european-culture',
  'Austria': 'western-european-culture', 'Switzerland': 'western-european-culture',
  'Luxembourg': 'western-european-culture',
  'Italy': 'mediterranean-culture', 'Spain': 'mediterranean-culture',
  'Portugal': 'mediterranean-culture', 'Greece': 'mediterranean-culture',
  'Malta': 'mediterranean-culture', 'Cyprus': 'mediterranean-culture',
  'Sweden': 'scandinavian-culture', 'Denmark': 'scandinavian-culture',
  'Finland': 'scandinavian-culture',
  'Russia': 'eastern-european-culture', 'Ukraine': 'eastern-european-culture',
  'Poland': 'eastern-european-culture', 'Romania': 'eastern-european-culture',
  'Hungary': 'eastern-european-culture', 'Belarus': 'eastern-european-culture',
  'Moldova': 'eastern-european-culture', 'Slovakia': 'eastern-european-culture',
  'Czech Republic': 'eastern-european-culture', 'Lithuania': 'eastern-european-culture',
  'Latvia': 'eastern-european-culture',
  'Croatia': 'balkan-culture', 'Bosnia': 'balkan-culture', 'Serbia': 'balkan-culture',
  'Kosovo': 'balkan-culture', 'Montenegro': 'balkan-culture', 'Slovenia': 'balkan-culture',
  'Bulgaria': 'balkan-culture',
  // Middle East, Iran, North Africa
  'Iran': 'iranian-culture',
  'Syria': 'middle-eastern-culture', 'Palestine': 'middle-eastern-culture',
  'Lebanon': 'middle-eastern-culture', 'Iraq': 'middle-eastern-culture',
  'Jordan': 'middle-eastern-culture', 'Saudi Arabia': 'middle-eastern-culture',
  'Yemen': 'middle-eastern-culture', 'Qatar': 'middle-eastern-culture',
  'Oman': 'middle-eastern-culture',
  'Egypt': 'north-african-culture', 'Algeria': 'north-african-culture',
  'Morocco': 'north-african-culture', 'Tunisia': 'north-african-culture',
  'Libya': 'north-african-culture', 'Sudan': 'north-african-culture',
  // Asia
  'Pakistan': 'south-asian', 'India': 'south-asian', 'Bangladesh': 'south-asian',
  'Nepal': 'south-asian',
  // Afghanistan sits with Central Asian, not South Asian: the UN groups it
  // South Asian, but 5 of the 6 Afghan members who joined a regional club
  // chose Central Asian. Their reckoning wins over the almanac's.
  'Afghanistan': 'central-asian-culture',
  'Kazakhstan': 'central-asian-culture', 'Uzbekistan': 'central-asian-culture',
  'Turkmenistan': 'central-asian-culture', 'Tajikistan': 'central-asian-culture',
  'Azerbaijan': 'central-asian-culture',
  'China': 'east-asian-culture', 'South Korea': 'east-asian-culture',
  'Taiwan': 'east-asian-culture', 'Mongolia': 'east-asian-culture',
  'Indonesia': 'southeast-asian-culture', 'Philippines': 'southeast-asian-culture',
  'Vietnam': 'southeast-asian-culture', 'Thailand': 'southeast-asian-culture',
  'Singapore': 'southeast-asian-culture', 'Myanmar': 'southeast-asian-culture',
  // Africa
  'Nigeria': 'west-african-culture', 'Gambia': 'west-african-culture',
  'Senegal': 'west-african-culture', 'Liberia': 'west-african-culture',
  'Kenya': 'east-african-culture', 'Ethiopia': 'east-african-culture',
  'Tanzania': 'east-african-culture', 'Somalia': 'east-african-culture',
  'Eritrea': 'east-african-culture', 'Rwanda': 'east-african-culture',
  'Djibouti': 'east-african-culture', 'Seychelles': 'east-african-culture',
  'South Africa': 'southern-african-culture', 'Zimbabwe': 'southern-african-culture',
  'Namibia': 'southern-african-culture', 'Botswana': 'southern-african-culture',
  // Oceania
  'Australia': 'australian-pacific-culture', 'New Zealand': 'australian-pacific-culture',
}

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
  nationality?: string | null
  newInTown: boolean
  excludeClubIds: string[]
  limit?: number
}): Promise<Club[]> {
  const { cityId, interests, languages = [], nationality, newInTown, excludeClubIds, limit = 4 } = opts
  // Languages and nationality alone are enough to build a lineup, so they
  // join the guard — a member who listed only those used to get nothing.
  const spoken = languages.map(l => l.trim().toLowerCase()).filter(l => l && !LINGUA_FRANCA.has(l))
  const homeClub = nationality ? NATIONALITY_TO_CLUB[nationality.trim()] : undefined
  if (interests.length === 0 && spoken.length === 0 && !homeClub && !newInTown) return []

  const all = await getClubs(cityId)
  const excluded = new Set(excludeClubIds)

  // Two interests pointing at the same category ("sailing" + "outdoor" →
  // Sports) compound, which is the right signal — that member really wants
  // the sporty clubs first.
  const wantedCategories = new Map<string, number>()
  for (const i of interests) {
    for (const cat of INTEREST_TO_CATEGORIES[i] ?? []) {
      // The 'languages' interest boosts the Language category, which is all
      // 13 Language clubs at once — that is how a Russian speaker's lineup
      // came back Arabic, Chinese, English, French. Once we know which
      // languages she actually speaks, that blanket boost is noise and the
      // per-club match below does the work instead.
      if (cat === 'Language' && spoken.length > 0) continue
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
        // Above a category match, not level with it. An interest points at a
        // whole category — 'languages' covers all 13 Language clubs at once —
        // while these name one club. At equal weight the specific match ties
        // with the blanket one and loses on alphabetical order, which is how
        // a Tunisian member's lineup came back Arabic, Chinese, English with
        // North African nowhere in it.
        (speaksFor(c) ? 4 : 0) +
        (homeClub && c.slug === homeClub ? 4 : 0) +
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
