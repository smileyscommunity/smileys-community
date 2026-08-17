// Validation for guide experience input (admin CRUD, Guide phase 2.3b).
//
// Server-side and shared by POST and PATCH, because the interesting rules are
// per city: a collection or mood is only valid if it exists in THAT city's
// vocabulary, and a neighborhood is only valid if it's in that city's registry.
// The admin form offers the right options, but the form is not the boundary.
//
// The one editorial rule enforced here: an entry cannot be PUBLISHED with an
// empty Smileys Take. The Take is the whole difference between this guide and
// scraped tourist copy — "things worth doing, recommended by people who actually
// live here" is a promise, and an entry without one silently breaks it. Drafts
// may be as empty as you like; publishing is the commitment.

import { collectionsFor, moodsFor, SEASON_VALUES } from './guide'
import { getNeighborhoodsForCity } from './neighborhoodsDb'

export interface GuideEntryValue {
  slug: string
  title: string
  emoji: string
  tagline: string
  collection: string
  moods: string[]
  seasons: string[]
  cost: string
  time: string
  when: string
  neighborhoods: string[]
  firstTime: boolean
  why: string
  take: string
  sections: { title: string; items: string[] }[]
  status: 'draft' | 'published'
  sortOrder: number
}

export type GuideEntryCheck =
  | { ok: true;  value: GuideEntryValue }
  | { ok: false; error: string }

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TITLE_MAX = 120
const TAGLINE_MAX = 200
const WHY_MAX = 4000
const TAKE_MAX = 1200

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean) : []
}

export async function validateGuideEntry(
  body: unknown,
  ctx: { cityId: string; citySlug: string },
): Promise<GuideEntryCheck> {
  const b = (body ?? {}) as Record<string, unknown>

  const title = str(b.title)
  if (!title) return { ok: false, error: 'Title is required' }
  if (title.length > TITLE_MAX) return { ok: false, error: `Title is too long (max ${TITLE_MAX})` }

  const slug = str(b.slug).toLowerCase()
  if (!slug) return { ok: false, error: 'Slug is required' }
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'Slug must be lowercase words separated by single hyphens' }

  const tagline = str(b.tagline)
  if (!tagline) return { ok: false, error: 'Tagline is required — it is the card copy' }
  if (tagline.length > TAGLINE_MAX) return { ok: false, error: `Tagline is too long (max ${TAGLINE_MAX})` }

  const emoji = str(b.emoji) || '✨'

  // Taxonomy is per city; an unknown value would render a card into no shelf at
  // all, which looks like the entry vanished.
  const collection = str(b.collection)
  const validCollections = collectionsFor(ctx.citySlug).map(c => c.value)
  if (!collection || !validCollections.includes(collection)) {
    return { ok: false, error: `Collection must be one of: ${validCollections.join(', ')}` }
  }

  const validMoods = moodsFor(ctx.citySlug).map(m => m.value)
  const moods = strArray(b.moods)
  const badMood = moods.find(m => !validMoods.includes(m))
  if (badMood) return { ok: false, error: `"${badMood}" is not a mood in ${ctx.citySlug}'s vocabulary` }

  const seasons = strArray(b.seasons)
  const badSeason = seasons.find(s => !(SEASON_VALUES as readonly string[]).includes(s))
  if (badSeason) return { ok: false, error: `"${badSeason}" is not a season (${SEASON_VALUES.join(', ')})` }

  // Neighborhoods drive "Explore nearby", which links by registry slug — a name
  // this city doesn't have would be dropped silently at render.
  const registry = (await getNeighborhoodsForCity(ctx.cityId)).map(n => n.name)
  const neighborhoods = strArray(b.neighborhoods)
  const badHood = neighborhoods.find(n => !registry.includes(n))
  if (badHood) return { ok: false, error: `"${badHood}" is not a neighborhood of this city` }

  const why = str(b.why)
  if (why.length > WHY_MAX) return { ok: false, error: `"Why go" is too long (max ${WHY_MAX})` }
  const take = str(b.take)
  if (take.length > TAKE_MAX) return { ok: false, error: `The Smileys Take is too long (max ${TAKE_MAX})` }

  const status = b.status === 'published' ? 'published' : 'draft'
  if (status === 'published') {
    if (!why)  return { ok: false, error: 'Write "Why go" before publishing' }
    // See the note at the top of this file: this is the guide's whole premise.
    if (!take) return { ok: false, error: 'Write The Smileys Take before publishing — an entry without one is just tourist copy' }
  }

  const rawSections = Array.isArray(b.sections) ? b.sections : []
  const sections = rawSections
    .map(sec => {
      const s = (sec ?? {}) as Record<string, unknown>
      return { title: str(s.title), items: strArray(s.items) }
    })
    // A section with no items renders as a bare heading.
    .filter(sec => sec.title && sec.items.length > 0)

  const sortOrderRaw = Number(b.sortOrder)
  const sortOrder = Number.isFinite(sortOrderRaw) ? Math.trunc(sortOrderRaw) : 0

  return {
    ok: true,
    value: {
      slug, title, emoji, tagline, collection, moods, seasons,
      cost: str(b.cost), time: str(b.time), when: str(b.when),
      neighborhoods, firstTime: b.firstTime === true,
      why, take, sections, status, sortOrder,
    },
  }
}

/** The Prisma data shape — `content` holds the long-form fields as JSON. */
export function guideEntryPayload(v: GuideEntryValue) {
  return {
    slug: v.slug, title: v.title, emoji: v.emoji, tagline: v.tagline,
    collection: v.collection, moods: v.moods, seasons: v.seasons,
    cost: v.cost || null, time: v.time || null, when: v.when || null,
    neighborhoods: v.neighborhoods, firstTime: v.firstTime,
    content: { why: v.why, take: v.take, sections: v.sections },
    status: v.status, sortOrder: v.sortOrder,
  }
}
