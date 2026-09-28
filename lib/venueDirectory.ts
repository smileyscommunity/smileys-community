import { prisma } from '@/lib/prisma'
import { foldPlaceName } from '@/lib/neighborhoods'

// When an event is created with a venue the organiser didn't pick from the
// directory, find the listing that venue name already has in the event's city
// (any status), or mirror it in as a PENDING listing (isApproved:false,
// isActive:true) — exactly the state the admin → Directory "pending" tab
// surfaces for review. The caller links the event to the id returned
// (Event.businessId), so once an admin approves the stub the event page's
// "View in directory" chip appears with no further matching.
//
// Never throws: a directory hiccup must not fail event creation.

// Obvious non-businesses — parks, waterfronts, campuses, walking routes.
// Admin review is the real quality gate; this just keeps the pending queue
// from filling with things that clearly aren't places to list. Matched
// against the normalized (whitespace-collapsed, lowercased) name.
const NON_VENUE = new Set([
  'moda seaside', 'kalamis marina', 'yoğurtçu park', 'kalamis ataturk parki',
  'göztepe sahil', 'caddebostan seaside', 'msgsu tophane',
])
const NON_VENUE_PREFIXES = ['🗺', 'route:']

// Names hosts type for a venue that already has a listing under another name,
// folded (foldPlaceName) → the listing's folded name. Each one produced a
// duplicate pending stub before this existed; they were merged 2026-09-28.
export const VENUE_ALIASES: Readonly<Record<string, string>> = {
  spicecorner:             'spicecornerindianrestaurant',
  karyaditsahne:           'karyatidsahne',
  blakyeldegirmeni:        'blakcoffeecoyeldegirmeni',
  blakcoffeeyeldegirmeni:  'blakcoffeecoyeldegirmeni',
  blackcoffeeyeldegirmeni: 'blakcoffeecoyeldegirmeni',
  buka:                    'bukayeldegirmeni',
  dozze:                   'dozzekadikoy',
}

type VenueRow = { id: string; name: string; isApproved: boolean; isActive: boolean }

/**
 * The listing a typed venue name means, among the city's rows: same name once
 * case, Turkish letters and punctuation are folded away ("DOZZE KADIKÖY" is
 * "Dozze Kadıköy" — Postgres' case-insensitive match missed that, because it
 * lowercases I to i, not ı), or a known alternate name (VENUE_ALIASES).
 * A live listing wins over a pending one, and a pending one over a hidden one:
 * hidden rows still match — that is what keeps a hidden non-venue from being
 * re-created as a fresh stub — but never beat the real listing.
 */
export function matchVenue(name: string, rows: VenueRow[]): VenueRow | null {
  const key = foldPlaceName(name)
  if (!key) return null
  const target = VENUE_ALIASES[key] ?? key
  const hits = rows.filter(r => { const f = foldPlaceName(r.name); return f === key || f === target })
  const rank = (r: VenueRow) => (r.isActive && r.isApproved ? 0 : r.isActive ? 1 : 2)
  return hits.sort((a, b) => rank(a) - rank(b))[0] ?? null
}

function inferCategory(name: string): string {
  const n = name.toLowerCase()
  if (/(coffee|cafe|café|kafe|roastary|roastery)/.test(n)) return 'Cafe'
  if (/(gastropub|pub|bar\b)/.test(n))                     return 'Bar'
  if (/(restaurant|kitchen|pizza|burger|lokanta|meyhane)/.test(n)) return 'Restaurant'
  return 'Other'
}

export async function ensurePendingVenueBusiness(opts: {
  location?: string | null
  // The event's city — a venue stub always lives where its event does.
  cityId: string
  neighborhood?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  submittedById?: string | null
}): Promise<string | null> {
  try {
    const name = (opts.location ?? '').replace(/\s+/g, ' ').trim()
    if (!name) return null
    if (NON_VENUE.has(name.toLowerCase())) return null
    if (NON_VENUE_PREFIXES.some(p => name.toLowerCase().startsWith(p))) return null

    // A listing with this name already in the event's city (any status) is the
    // venue. The lookup was city-blind, so a same-named café in another city
    // stopped this city's stub from ever being made. Matched in code, not SQL,
    // so the Turkish fold and the aliases apply (a city has a few hundred rows).
    const cityRows = await prisma.business.findMany({
      where:  { cityId: opts.cityId },
      select: { id: true, name: true, isApproved: true, isActive: true },
    })
    const existing = matchVenue(name, cityRows)
    if (existing) return existing.id

    const created = await prisma.business.create({
      data: {
        name,
        cityId:        opts.cityId,
        category:      inferCategory(name),
        description:   'Community venue — added from a Smileys event. Pending review.',
        neighborhood:  opts.neighborhood?.trim() || null,
        address:       opts.address?.trim() || null,
        latitude:      opts.latitude ?? null,
        longitude:     opts.longitude ?? null,
        tags:          ['Smileys venue'],
        isApproved:    false,  // pending — hidden from the public directory
        isActive:      true,
        submittedById: opts.submittedById ?? null,
      },
      select: { id: true },
    })
    return created.id
  } catch {
    // A directory hiccup must never break event creation.
    return null
  }
}
