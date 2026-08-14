// Import event venues into the business directory.
//
// The directory's cold-start problem: a handful of entries, while the
// events table holds dozens of real businesses the community demonstrably
// uses. This imports every venue that hosted a non-cancelled event,
// carrying over neighborhood, address, and coordinates from the event
// rows. Venues with >= AUTO_APPROVE_MIN events are trusted and publish
// directly; single-event venues are imported as PENDING (isApproved:false)
// so an admin can vet them in the directory approval queue before they go
// live. Entries are tagged 'We meet here' and get a purely factual
// description ("has hosted N Smileys event(s) since <month year>") — no
// invented copy, so these rows don't repeat the seeded-placeholder problem
// that cleanup-seed-directory.ts had to purge.
//
// Idempotent on business name (case-insensitive) — existing rows are
// skipped, never updated. Default mode is dry-run; re-run with --write
// to insert.
//
// Run on prod:
//   ssh root@<server> 'cd /root/smileys-community && \
//     npx tsx --env-file=.env scripts/import-event-venues.ts'          # dry run
//   ssh root@<server> 'cd /root/smileys-community && \
//     npx tsx --env-file=.env scripts/import-event-venues.ts --write'  # insert

import { prisma } from '@/lib/prisma'

// Venues with >= this many non-cancelled events are trusted enough to
// publish straight to the directory. Fewer (i.e. a single event so far)
// still import, but land as PENDING for an admin to vet in the approval
// queue before they go live.
const AUTO_APPROVE_MIN = 2
const ADMIN_EMAIL = 'info@smileyscommunity.com'

// Meeting spots that aren't businesses — parks, waterfronts, campuses,
// walking routes. Matched against the normalized (aliased) name.
const EXCLUDE = new Set([
  'Moda Seaside',
  'Kalamis Marina',
  'Yoğurtçu Park',
  'Kalamis Ataturk Parki',
  'Göztepe Sahil',
  'Caddebostan seaside',
  'MSGSU Tophane',
])
// Route descriptions and similar free-text "locations" — excluded by
// prefix so emoji/edits don't dodge the filter.
const EXCLUDE_PREFIXES = ['🗺', 'Route:']

// Same venue entered under different names → canonical name.
const ALIAS: Record<string, string> = {
  'Buka': 'Buka Yeldeğirmeni',
  'Yoğurtçu Park Kafe': 'Yoğurtçu Park Kafe', // keep distinct from the park itself
  // The venue's brand name is "BLAK Coffee Co." — event entries used
  // shortened variants (rows canonicalized in prod 2026-07-12).
  'Blak Coffee Yeldeğirmeni':  'BLAK Coffee Co. Yeldeğirmeni',
  'Blak Yeldeğirmeni':         'BLAK Coffee Co. Yeldeğirmeni',
  'Black Coffee Yeldeğirmeni': 'BLAK Coffee Co. Yeldeğirmeni',
  // Event entries spell/abbreviate these differently than the existing
  // directory listing — canonicalize so they're skipped as duplicates
  // instead of creating a near-dupe of a venue already in the directory.
  'Roastary Coffee': 'Roastory Coffee',
  'Mikel':           'Mikel Coffee Company',
}

// Light keyword-based category guess. Anything unrecognized lands in
// 'Other' for an admin to re-categorize — better than inventing one.
function inferCategory(name: string): string {
  const n = name.toLowerCase()
  if (/(coffee|cafe|café|kafe|roastary|roastery)/.test(n)) return 'Cafe'
  if (/(gastropub|pub|bar\b)/.test(n)) return 'Bar'
  if (/(restaurant|kitchen|pizza|burger)/.test(n)) return 'Restaurant'
  return 'Other'
}

function monthYear(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function mode(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null, bestN = 0
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n }
  return best
}

async function main() {
  const write = process.argv.includes('--write')

  const events = await prisma.event.findMany({
    where: { cancelledAt: null, NOT: { location: '' } },
    select: { location: true, neighborhood: true, address: true, lat: true, lng: true, date: true, cityId: true },
  })

  // Group by normalized venue name.
  const groups = new Map<string, typeof events>()
  for (const e of events) {
    const raw = e.location.replace(/\s+/g, ' ').trim()
    const name = ALIAS[raw] ?? raw
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push(e)
  }

  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } })
  if (!admin) console.warn(`⚠ No user found for ${ADMIN_EMAIL} — submittedById will be null`)

  let approved = 0, pending = 0, skippedExisting = 0
  const planned: string[] = []

  for (const [name, evs] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    // Every venue with >= 1 event is a candidate now (single-event ones
    // just land as pending below). Non-business meeting spots are filtered
    // by the EXCLUDE lists; anything else that slips through gets caught in
    // the approval queue.
    if (EXCLUDE.has(name) || EXCLUDE_PREFIXES.some(p => name.startsWith(p))) continue

    const existing = await prisma.business.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    })
    if (existing) { skippedExisting++; console.log(`= exists, skipping: ${name}`); continue }

    const coords = evs.filter(e => e.lat != null && e.lng != null)
    const lat = coords.length ? coords.reduce((s, e) => s + e.lat!, 0) / coords.length : null
    const lng = coords.length ? coords.reduce((s, e) => s + e.lng!, 0) / coords.length : null
    const address      = mode(evs.map(e => (e.address ?? '').trim()).filter(Boolean))
    const neighborhood = mode(evs.map(e => e.neighborhood.trim()).filter(Boolean))
    const firstDate    = evs.map(e => e.date).sort()[0]
    const category     = inferCategory(name)

    const description =
      `A ${neighborhood ?? 'Istanbul'} regular for the Smileys community — has hosted ` +
      `${evs.length} Smileys event${evs.length === 1 ? '' : 's'} since ${monthYear(firstDate)}.`

    // >= 2 events publishes directly; a lone event goes to the approval
    // queue (isApproved:false, isActive:true = the directory's "pending"
    // bucket) so an admin decides whether it's a real, listable venue.
    const isApproved = evs.length >= AUTO_APPROVE_MIN

    planned.push(
      `+ ${name}  [${category}] ${neighborhood ?? '—'} · ${evs.length} event${evs.length === 1 ? '' : 's'}` +
      ` · ${isApproved ? 'approved' : 'PENDING'}` +
      `${address ? ' · addr ✓' : ''}${lat != null ? ' · coords ✓' : ''}`
    )

    if (write) {
      await prisma.business.create({
        data: {
          name, category, description,
          // A venue stub lives where its events do — same rule as
          // ensurePendingVenueBusiness. Grouping is by venue name, so every
          // event in the group is at the same address, hence the same city.
          cityId: evs[0].cityId,
          neighborhood, address,
          latitude: lat, longitude: lng,
          isExpatFriendly: true,
          isApproved, isActive: true,
          submittedById: admin?.id ?? null,
          tags: ['We meet here'],
        },
      })
      isApproved ? approved++ : pending++
    }
  }

  const pendingPlanned = planned.filter(p => p.includes(' · PENDING')).length
  console.log('\n' + planned.join('\n'))
  console.log(
    write
      ? `\n✓ Created ${approved + pending} businesses — ${approved} approved, ${pending} pending review (${skippedExisting} already existed)`
      : `\nDRY RUN — would create ${planned.length} businesses (${planned.length - pendingPlanned} approved, ${pendingPlanned} pending review; ${skippedExisting} already exist). Re-run with --write to insert.`
  )
}

main().finally(() => prisma.$disconnect())
