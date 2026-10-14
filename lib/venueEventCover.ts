// A directory listing's fallback cover: the photo of the most recent
// non-cancelled event held at that venue (matched by location name, same alias
// convention as scripts/import-event-venues.ts). Factual by construction — the
// photo is one the community already published for an event there. City-scoped,
// so a same-named venue in another city can never donate its picture.
//
// Used by scripts/propose-directory-covers.ts (all cover-less listings) and
// scripts/fill-directory-listings.ts (one listing, when its own website gave no
// usable photo).

import { prisma } from '@/lib/prisma'

// Same venue entered under different names → canonical name.
export const VENUE_ALIAS: Record<string, string> = {
  'Buka': 'Buka Yeldeğirmeni',
  'Blak Coffee Yeldeğirmeni':  'BLAK Coffee Co. Yeldeğirmeni',
  'Blak Yeldeğirmeni':         'BLAK Coffee Co. Yeldeğirmeni',
  'Black Coffee Yeldeğirmeni': 'BLAK Coffee Co. Yeldeğirmeni',
}

export const normVenue = (s: string) =>
  (VENUE_ALIAS[s.replace(/\s+/g, ' ').trim()] ?? s.replace(/\s+/g, ' ').trim()).toLowerCase()

export type EventCover = { url: string; title: string; date: string }

/** The newest event photo for this venue in its own city, or null. */
export async function eventCoverFor(business: { name: string; cityId: string }): Promise<EventCover | null> {
  const want = normVenue(business.name)
  if (!want) return null
  const events = await prisma.event.findMany({
    where:   { cityId: business.cityId, coverImage: { not: null }, cancelledAt: null },
    select:  { location: true, coverImage: true, date: true, title: true },
    orderBy: { date: 'desc' },
  })
  const hit = events.find(e => e.location && normVenue(e.location) === want)
  return hit?.coverImage ? { url: hit.coverImage, title: hit.title, date: hit.date } : null
}
