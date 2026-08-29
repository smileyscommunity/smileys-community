// Handbook category metadata — the single source of truth for the Handbook's
// information architecture. Imported by the index, the category pages, the
// article page and the admin post form so a rename happens in one place.
//
// The Handbook answers "how does this city work?". That is a different job from
// the Guide (why experience it), the Directory (who provides it), and
// Neighborhoods (where is it) — keep category names practical, not evocative.
//
// `image` is the category hero banner and is OPTIONAL: only the five original
// categories were ever illustrated. Callers must handle null rather than
// rendering a broken <img>. Static assets live in public/images and are served
// under the /app basePath, so the src is the full '/app/images/…' path.

export type Volatility = 'high' | 'medium' | 'low'

export type CategoryMeta = {
  emoji:      string
  label:      string
  tagline:    string
  image?:     { src: string; alt: string }
  /** How fast this topic's facts rot — drives the default review cadence. */
  volatility: Volatility
  /** Acting on stale info here costs real money, time or legal standing.
   *  These articles render the "verify before you act" warning (brief §18). */
  highStakes?: boolean
}

// Default review cadence per volatility tier. There is deliberately no single
// universal period: fares and visa rules change several times a year, dining
// etiquette does not. A per-article `reviewIntervalDays` overrides this.
export const REVIEW_INTERVAL_DAYS: Record<Volatility, number> = {
  high:   90,
  medium: 180,
  low:    365,
}

// Insertion order is display order: arrival → movement → settling → systems.
export const HANDBOOK_CATEGORIES: Record<string, CategoryMeta> = {
  'Getting Started': {
    emoji: '🚀', label: 'Getting Started', tagline: 'Your first 24 hours, first week, first month.',
    volatility: 'medium',
  },
  // Tagline names no city-specific mode (Marmaray is Istanbul's alone) — the
  // same rule as the 'Living in Istanbul' rename below: this copy renders on
  // every city's handbook.
  'Getting Around': {
    emoji: '🚇', label: 'Getting Around', tagline: 'Transport cards, buses, ferries, taxis, airports — however your city moves, the answers are simple.',
    image: { src: '/app/images/handbook-getting-around.jpeg', alt: 'Getting Around — Smileys Handbook' },
    volatility: 'high',
  },
  // Renamed from 'Living in Istanbul': a category label must not name a city.
  // The Handbook is now per-city (see app/handbook/page.tsx), and a shelf headed
  // "Living in Istanbul" would render on Izmir's handbook the moment any article
  // filed here is global. The old key still resolves — see the aliases below.
  'Home & Housing': {
    emoji: '🏠', label: 'Home & Housing', tagline: 'Finding a home, renting, utilities, moving in.',
    image: { src: '/app/images/handbook-daily-life.jpeg', alt: 'Home & Housing — Smileys Handbook' },
    volatility: 'medium',
  },
  'Money & Banking': {
    emoji: '💳', label: 'Money & Banking', tagline: 'Bank accounts, tax numbers, cards, transfers.',
    image: { src: '/app/images/handbook-money.jpeg', alt: 'Money & Banking — Smileys Handbook' },
    volatility: 'high', highStakes: true,
  },
  'Mobile & Digital': {
    emoji: '📱', label: 'Mobile & Digital', tagline: 'SIMs, eSIMs, home internet, e-Devlet, the apps you actually need.',
    volatility: 'high',
  },
  'Healthcare': {
    emoji: '🏥', label: 'Healthcare', tagline: 'How the system works — public vs private, pharmacies, insurance, emergencies.',
    volatility: 'high', highStakes: true,
  },
  'Residence & Legal': {
    emoji: '🛂', label: 'Residence & Legal', tagline: 'Permits, address registration, work permits — the slow grind of being legal.',
    image: { src: '/app/images/handbook-bureaucracy.jpeg', alt: 'Residence & Legal — Smileys Handbook' },
    volatility: 'high', highStakes: true,
  },
  'Everyday Life': {
    emoji: '🛒', label: 'Everyday Life', tagline: 'Shopping, deliveries, schools, pets, the small things that wear you down until they don\'t.',
    image: { src: '/app/images/handbook-family.jpeg', alt: 'Everyday Life — Smileys Handbook' },
    volatility: 'medium',
  },
  'Safety & Emergencies': {
    emoji: '🛡️', label: 'Safety & Emergencies', tagline: 'Emergency numbers, scams, earthquake preparedness, lost documents.',
    volatility: 'medium', highStakes: true,
  },
  'Language & Culture': {
    emoji: '🗣️', label: 'Language & Culture', tagline: 'Useful Turkish, etiquette, and the misunderstandings worth skipping.',
    volatility: 'low',
  },
}

export const CATEGORY_KEYS = Object.keys(HANDBOOK_CATEGORIES)

// Category keys stored on rows written before the 10-category IA landed.
// Resolved at read time so the existing articles keep working without a
// production data migration — and so old /handbook/category/<key> URLs, which
// are indexed, keep resolving instead of 404ing.
//
// 'Family' has no direct successor in the new IA: the brief folds schools and
// kids' services into Everyday Life rather than giving family its own top-level
// category.
export const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  'Bureaucracy':        'Residence & Legal',
  'Money':              'Money & Banking',
  'Daily Life':         'Home & Housing',
  'Family':             'Everyday Life',
  // Was a canonical key until the Handbook went per-city. Aliased rather than
  // migrated: rows still store it, /handbook/category/Living%20in%20Istanbul is
  // indexed, and storedKeysFor() queries both so nothing drops out of the list.
  'Living in Istanbul': 'Home & Housing',
}

/** Canonical category key for a stored value — resolves legacy aliases.
 *  Returns null when the value matches nothing (a typo in the admin form),
 *  so callers can skip it rather than render an orphan category. */
export function canonicalCategory(stored: string): string | null {
  if (HANDBOOK_CATEGORIES[stored]) return stored
  const alias = LEGACY_CATEGORY_ALIASES[stored]
  return alias && HANDBOOK_CATEGORIES[alias] ? alias : null
}

/** Every stored value that maps to a canonical category — the set to query
 *  with when listing a category, so legacy rows appear alongside new ones. */
export function storedKeysFor(canonical: string): string[] {
  const legacy = Object.entries(LEGACY_CATEGORY_ALIASES)
    .filter(([, target]) => target === canonical)
    .map(([old]) => old)
  return [canonical, ...legacy]
}

export function categoryMeta(stored: string): CategoryMeta | null {
  const key = canonicalCategory(stored)
  return key ? HANDBOOK_CATEGORIES[key] : null
}

/** The category hero banner, or null when the category has no illustration
 *  (most of them) — callers must treat null as "render text-first". */
export function categoryHero(stored: string): { src: string; alt: string } | null {
  return categoryMeta(stored)?.image ?? null
}
