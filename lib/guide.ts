// Istanbul Guide — experience content layer. The Guide answers "what
// should I experience?" (the Handbook answers "how do I function here",
// the Directory "where do I find a business"). Experiences are editorial
// JSON (data/guide-experiences.json) — repo-managed for now, so content
// ships with deploys; user interactions (saves/recommends) come later as
// DB rows keyed by slug.
// §4 of the plan — mood-based discovery beats category trees. Values are
// stable ids used in experience JSON + URL params; labels/emoji render
// the chips. Order = display order.
export interface GuideTaxon { value: string; label: string; emoji: string }

// Istanbul's vocabulary. "Be by the Bosphorus" is not a mood a Bodrum member
// can act on, which is the whole reason these are per city now: a shared list
// forces every city to describe itself in the flagship's geography.
const ISTANBUL_MOODS: GuideTaxon[] = [
  { value: 'eat',       label: 'Eat Something Great',          emoji: '🍽️' },
  { value: 'bosphorus', label: 'Be by the Bosphorus',          emoji: '🌊' },
  { value: 'iconic',    label: 'See Something Iconic',         emoji: '🏛️' },
  { value: 'night-out', label: 'Go Out Tonight',               emoji: '🍸' },
  { value: 'escape',    label: 'Escape the City',              emoji: '🌿' },
  { value: 'different', label: 'Discover Something Different', emoji: '🎨' },
  { value: 'free',      label: 'Do Something Free',            emoji: '💸' },
  { value: 'rainy',     label: "It's Raining",                 emoji: '☔' },
  { value: 'night',     label: 'Istanbul at Night',            emoji: '🌙' },
  { value: 'people',    label: 'Meet People',                  emoji: '👥' },
]

// Bodrum is a peninsula of bays, beaches, marinas and seasons, so its discovery
// verbs are different ones: get on a boat, find a beach, catch the sunset,
// escape the crowds. Deliberately NOT a translation of Istanbul's list.
const BODRUM_MOODS: GuideTaxon[] = [
  { value: 'beach',     label: 'Find a Beach',          emoji: '🌊' },
  { value: 'boat',      label: 'Get on a Boat',         emoji: '⛵' },
  { value: 'eat',       label: 'Eat Something Great',   emoji: '🍽️' },
  { value: 'sunset',    label: 'Watch the Sunset',      emoji: '🌅' },
  { value: 'night-out', label: 'Go Out Tonight',        emoji: '🍸' },
  { value: 'history',   label: 'Explore History',       emoji: '🏛️' },
  { value: 'escape',    label: 'Escape the Crowds',     emoji: '🌿' },
  { value: 'peninsula', label: 'Explore the Peninsula', emoji: '🏘️' },
  { value: 'people',    label: 'Meet People',           emoji: '💃' },
  { value: 'summer',    label: 'Make the Most of Summer', emoji: '☀️' },
]

// İzmir faces west across its own gulf: the ferry crossing is a daily ritual,
// the whole city watches the sunset, and the weekend move is the peninsula
// (Urla, Alaçatı, Sığacık). Its verbs come from that geography.
const IZMIR_MOODS: GuideTaxon[] = [
  { value: 'bay',       label: 'Cross the Bay',                emoji: '⛴️' },
  { value: 'eat',       label: 'Eat Something Great',          emoji: '🍽️' },
  { value: 'sunset',    label: 'Watch the Sunset',             emoji: '🌅' },
  { value: 'iconic',    label: 'See Something Iconic',         emoji: '🏛️' },
  { value: 'night-out', label: 'Go Out Tonight',               emoji: '🍸' },
  { value: 'peninsula', label: 'Head to the Peninsula',        emoji: '🍇' },
  { value: 'escape',    label: 'Escape the City',              emoji: '🌿' },
  { value: 'free',      label: 'Do Something Free',            emoji: '💸' },
  { value: 'different', label: 'Discover Something Different', emoji: '🎨' },
  { value: 'people',    label: 'Meet People',                  emoji: '👥' },
]

// A city with no vocabulary of its own gets verbs that name no geography, so a
// new launch reads as itself rather than as a copy of Istanbul. Whoever writes
// that city's guide replaces this with its own list.
const GENERIC_MOODS: GuideTaxon[] = [
  { value: 'eat',       label: 'Eat Something Great',          emoji: '🍽️' },
  { value: 'iconic',    label: 'See Something Iconic',         emoji: '🏛️' },
  { value: 'night-out', label: 'Go Out Tonight',               emoji: '🍸' },
  { value: 'escape',    label: 'Escape the Crowds',            emoji: '🌿' },
  { value: 'different', label: 'Discover Something Different', emoji: '🎨' },
  { value: 'free',      label: 'Do Something Free',            emoji: '💸' },
  { value: 'people',    label: 'Meet People',                  emoji: '👥' },
]

// §7 — collections group experiences into browsable shelves.
const ISTANBUL_COLLECTIONS: GuideTaxon[] = [
  { value: 'bosphorus', label: 'Life on the Bosphorus', emoji: '🌊' },
  { value: 'eat',       label: 'Eat Istanbul',          emoji: '🍽️' },
  { value: 'night',     label: 'Istanbul After Dark',   emoji: '🌙' },
  { value: 'free',      label: 'Istanbul for Free',     emoji: '💸' },
  { value: 'escape',    label: 'Escape Istanbul',       emoji: '🌿' },
  { value: 'different', label: 'Beyond the Obvious',    emoji: '🎨' },
]

const BODRUM_COLLECTIONS: GuideTaxon[] = [
  { value: 'beaches',   label: 'Beaches & Bays',         emoji: '🏖️' },
  { value: 'boat',      label: 'Boat Life',              emoji: '⛵' },
  { value: 'eat',       label: 'Taste Bodrum',           emoji: '🍽️' },
  { value: 'night',     label: 'Bodrum After Dark',      emoji: '🌙' },
  { value: 'sunset',    label: 'Sunset',                 emoji: '🌅' },
  { value: 'history',   label: 'History & Culture',      emoji: '🏛️' },
  { value: 'hidden',    label: 'Beyond the Beach Clubs', emoji: '🌿' },
  { value: 'day-trips', label: 'Day Trips',              emoji: '🏝️' },
]

// Six shelves like Istanbul's; no "for free" shelf — free stays a mood chip,
// and İzmir's ancient layers (Agora, Kadifekale, the Asansör, Konak) earn a
// history shelf of their own instead of hiding under "different".
const IZMIR_COLLECTIONS: GuideTaxon[] = [
  { value: 'bay',       label: 'Life on the Bay',    emoji: '⛴️' },
  { value: 'eat',       label: 'Eat İzmir',          emoji: '🍽️' },
  { value: 'night',     label: 'İzmir After Dark',   emoji: '🌙' },
  { value: 'history',   label: 'Layers of Smyrna',   emoji: '🏛️' },
  { value: 'peninsula', label: 'Peninsula Weekends', emoji: '🍇' },
  { value: 'escape',    label: 'Escape the City',    emoji: '🌿' },
]

const GENERIC_COLLECTIONS: GuideTaxon[] = [
  { value: 'eat',       label: 'Eat Well',            emoji: '🍽️' },
  { value: 'night',     label: 'After Dark',          emoji: '🌙' },
  { value: 'free',      label: 'For Free',            emoji: '💸' },
  { value: 'escape',    label: 'Escape the Crowds',   emoji: '🌿' },
  { value: 'different', label: 'Beyond the Obvious',  emoji: '🎨' },
]

// Keyed by city SLUG, not id: these are editorial vocabularies that live with
// the code, and a slug is what a reader of this file recognises.
const CITY_MOODS:       Record<string, GuideTaxon[]> = { istanbul: ISTANBUL_MOODS, bodrum: BODRUM_MOODS, izmir: IZMIR_MOODS }
const CITY_COLLECTIONS: Record<string, GuideTaxon[]> = { istanbul: ISTANBUL_COLLECTIONS, bodrum: BODRUM_COLLECTIONS, izmir: IZMIR_COLLECTIONS }

export function moodsFor(citySlug: string): GuideTaxon[] {
  return CITY_MOODS[citySlug] ?? GENERIC_MOODS
}

export function collectionsFor(citySlug: string): GuideTaxon[] {
  return CITY_COLLECTIONS[citySlug] ?? GENERIC_COLLECTIONS
}

/** Does this city define its own guide vocabulary, or is it on the generic set? */
export function hasOwnGuideTaxonomy(citySlug: string): boolean {
  return citySlug in CITY_MOODS
}

// Values are per-city strings now, so these can't be narrow unions any more —
// validity depends on which city an entry belongs to. moodsFor/collectionsFor
// are the check.
export type GuideMood = string
export type GuideCollection = string

// ── §14 — "What kind of <city> are you looking for?" ────────────────────────
// Audience-based curation over the SAME experiences: no new content type, no
// second database. An audience is a saved query across a city's own vocabulary.
//
// The hard rule here is that an audience must be BACKED by that vocabulary.
// "Families" and "Digital nomads" are in the brief and are deliberately absent:
// nothing in the taxonomy records whether an experience suits a five-year-old or
// has wifi, so any mapping would be a guess — and a guess here recommends a
// beach-club night to someone travelling with kids. Add the audience when the
// data can answer it (a `family` mood, a coworking flag), not before.
export interface GuideAudience {
  value: string
  label: string
  emoji: string
  /** Matches an experience carrying ANY of these moods. */
  moods: string[]
  /** …or sitting on ANY of these shelves. */
  collections: string[]
  /** Or, for "first time", the curated first-timer flag instead of a query. */
  firstTimeOnly?: boolean
}

const BODRUM_AUDIENCES: GuideAudience[] = [
  { value: 'first-time',  label: 'First time',   emoji: '🧭', moods: [], collections: [], firstTimeOnly: true },
  { value: 'beach-lover', label: 'Beach lover',  emoji: '🏖️', moods: ['beach'],     collections: ['beaches'] },
  { value: 'sailing',     label: 'Sailing',      emoji: '⛵', moods: ['boat'],      collections: ['boat'] },
  { value: 'foodie',      label: 'Foodie',       emoji: '🍽️', moods: ['eat'],       collections: ['eat'] },
  { value: 'nightlife',   label: 'Nightlife',    emoji: '🍸', moods: ['night-out'], collections: ['night'] },
  { value: 'couples',     label: 'Couples',      emoji: '🌅', moods: ['sunset'],    collections: ['sunset'] },
  { value: 'solo',        label: 'Solo',         emoji: '🙋', moods: ['people'],    collections: [] },
  { value: 'slow',        label: 'Slow Bodrum',  emoji: '🌿', moods: ['escape'],    collections: ['hidden'] },
]

const ISTANBUL_AUDIENCES: GuideAudience[] = [
  { value: 'first-time', label: 'First time',  emoji: '🧭', moods: [], collections: [], firstTimeOnly: true },
  { value: 'foodie',     label: 'Foodie',      emoji: '🍽️', moods: ['eat'],       collections: ['eat'] },
  { value: 'nightlife',  label: 'Nightlife',   emoji: '🍸', moods: ['night-out'], collections: ['night'] },
  { value: 'solo',       label: 'Solo',        emoji: '🙋', moods: ['people'],    collections: [] },
  { value: 'budget',     label: 'On a budget', emoji: '💸', moods: ['free'],      collections: ['free'] },
  { value: 'slow',       label: 'Slow days',   emoji: '🌿', moods: ['escape'],    collections: ['escape'] },
  { value: 'curious',    label: 'Something different', emoji: '🎨', moods: ['different'], collections: ['different'] },
]

const GENERIC_AUDIENCES: GuideAudience[] = [
  { value: 'first-time', label: 'First time',  emoji: '🧭', moods: [], collections: [], firstTimeOnly: true },
  { value: 'foodie',     label: 'Foodie',      emoji: '🍽️', moods: ['eat'],       collections: ['eat'] },
  { value: 'nightlife',  label: 'Nightlife',   emoji: '🍸', moods: ['night-out'], collections: ['night'] },
  { value: 'solo',       label: 'Solo',        emoji: '🙋', moods: ['people'],    collections: [] },
  { value: 'slow',       label: 'Slow days',   emoji: '🌿', moods: ['escape'],    collections: ['escape'] },
]

const CITY_AUDIENCES: Record<string, GuideAudience[]> = {
  istanbul: ISTANBUL_AUDIENCES,
  bodrum:   BODRUM_AUDIENCES,
}

/**
 * The audiences a city can actually honour.
 *
 * Every mood and collection is checked against that city's live vocabulary and
 * dropped if absent, so a renamed taxon or a city on the reduced generic set
 * silently narrows the list instead of offering a chip that matches nothing. An
 * audience left with no query at all (and no first-timer flag) is dropped
 * entirely — that's the case a typo would produce.
 */
export function audiencesFor(citySlug: string): GuideAudience[] {
  const moodValues = new Set(moodsFor(citySlug).map(m => m.value))
  const collValues = new Set(collectionsFor(citySlug).map(c => c.value))
  return (CITY_AUDIENCES[citySlug] ?? GENERIC_AUDIENCES)
    .map(a => ({
      ...a,
      moods:       a.moods.filter(m => moodValues.has(m)),
      collections: a.collections.filter(c => collValues.has(c)),
    }))
    .filter(a => a.firstTimeOnly || a.moods.length > 0 || a.collections.length > 0)
}

/** Does an experience belong to this audience? */
export function matchesAudience(
  exp: { moods?: string[]; collection?: string | null; firstTime?: boolean },
  audience: GuideAudience,
): boolean {
  if (audience.firstTimeOnly) return exp.firstTime === true
  const moods = exp.moods ?? []
  return audience.moods.some(m => moods.includes(m))
    || (!!exp.collection && audience.collections.includes(exp.collection))
}

// ── §15 — the season axis ────────────────────────────────────────────────────
// A separate axis from moods and collections on purpose: "when in the year" is
// orthogonal to "what am I in the mood for", and a place like Bodrum changes
// character completely between August and February. `Experience.when` is display
// copy; these values are data.
export interface GuideSeason extends GuideTaxon { line: string }

export const SEASON_VALUES = ['spring', 'summer', 'autumn', 'winter'] as const
export type SeasonValue = typeof SEASON_VALUES[number]

// Bodrum's lines come from the brief. The point of §15 is that the peninsula is
// not a two-month destination — the sea holds its warmth into October and
// winter is when the local town reappears.
const BODRUM_SEASONS: GuideSeason[] = [
  { value: 'summer', label: 'Summer',           emoji: '☀️', line: 'Beach days, boats, nightlife and events.' },
  { value: 'spring', label: 'Spring',           emoji: '🌿', line: 'Walking, food, villages and quieter beaches.' },
  { value: 'autumn', label: 'September–October', emoji: '🍂', line: 'The sea is still warm, the crowds are gone.' },
  { value: 'winter', label: 'Winter',           emoji: '🌧️', line: 'Local life, cafés, walks and culture.' },
]

// Names no geography and promises no weather, so it is safe for any city until
// someone writes that city's own lines.
const GENERIC_SEASONS: GuideSeason[] = [
  { value: 'summer', label: 'Summer', emoji: '☀️', line: 'The hottest, busiest months.' },
  { value: 'spring', label: 'Spring', emoji: '🌿', line: 'Mild days, fewer people.' },
  { value: 'autumn', label: 'Autumn', emoji: '🍂', line: 'Still warm, much quieter.' },
  { value: 'winter', label: 'Winter', emoji: '🌧️', line: 'The indoor, local season.' },
]

const CITY_SEASONS: Record<string, GuideSeason[]> = { bodrum: BODRUM_SEASONS }

export function seasonsFor(citySlug: string): GuideSeason[] {
  return CITY_SEASONS[citySlug] ?? GENERIC_SEASONS
}

/**
 * Which season a city is in right now, by month in ITS timezone.
 *
 * Northern-hemisphere months, which every Smileys city shares today. A southern
 * city needs this shifted by six months — this is the one place to do it, and
 * it should key off the city rather than being assumed.
 */
export function seasonNow(timeZone: string): SeasonValue {
  const month = Number(new Intl.DateTimeFormat('en-GB', { month: 'numeric', timeZone }).format(new Date()))
  if (month >= 3 && month <= 5)  return 'spring'
  if (month >= 6 && month <= 8)  return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}

export interface ExperienceSection {
  title: string
  items: string[]
}

export interface Experience {
  slug: string
  title: string
  emoji: string
  collection: GuideCollection
  moods: GuideMood[]
  // Card copy — one line that sells the experience (§8: don't clutter).
  tagline: string
  // Meta chips: cost ('Free' | 'Free-ish' | '₺' | '₺₺' | '₺₺₺'), rough
  // duration, and when to go. Freeform strings — they're display copy.
  cost: string
  time: string
  when: string
  // §15 — which parts of the year this is for. Empty = all year.
  seasons: string[]
  // §9 template.
  why: string
  take: string          // §10 — The Smileys Take. Short, opinionated, honest.
  sections: ExperienceSection[]
  // §13 — neighborhoods to link ("Explore nearby"). Must be
  // NEIGHBORHOOD_META names or they're skipped at render.
  neighborhoods: string[]
  // §6 — surfaces on the "First time in Istanbul?" strip.
  firstTime?: boolean
  // Annotated at render time by the server loader when
  // public/images/guide/<slug>.jpg exists — never set in the JSON.
  photo?: string | null
  // Contextual integrations (IA brief §16/§18/§19) — the Guide references
  // canonical homes, never duplicates them. All optional.
  handbook?: { slug: string; label: string }[]
  directory?: { label: string; href: string }
  clubs?: string[]
}
