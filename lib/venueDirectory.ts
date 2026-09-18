import { prisma } from '@/lib/prisma'

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
    // stopped this city's stub from ever being made.
    const existing = await prisma.business.findFirst({
      where:  { name: { equals: name, mode: 'insensitive' }, cityId: opts.cityId },
      select: { id: true },
    })
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
