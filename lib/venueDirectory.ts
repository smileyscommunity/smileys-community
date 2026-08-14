import { prisma } from '@/lib/prisma'

// When an event is created with a venue, mirror that venue into the business
// directory as a PENDING listing (isApproved:false, isActive:true) — which is
// exactly the state the admin → Directory "pending" tab surfaces for review.
// Once an admin approves it, it goes live AND the event page's "View in
// directory" link starts matching (that match requires an approved+active
// business whose name equals the event's location, case-insensitive).
//
// Fire-and-forget: this must never block or fail event creation.

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
}): Promise<void> {
  try {
    const name = (opts.location ?? '').replace(/\s+/g, ' ').trim()
    if (!name) return
    if (NON_VENUE.has(name.toLowerCase())) return
    if (NON_VENUE_PREFIXES.some(p => name.toLowerCase().startsWith(p))) return

    // Skip if a business with this name already exists (any status) — same
    // case-insensitive name match the event page uses to link.
    const existing = await prisma.business.findFirst({
      where:  { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    })
    if (existing) return

    await prisma.business.create({
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
    })
  } catch {
    // A directory hiccup must never break event creation.
  }
}
