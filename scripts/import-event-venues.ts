// Import recurring event venues into the business directory.
//
// The directory's cold-start problem: 3 entries, while the events table
// holds dozens of real businesses the community demonstrably uses. This
// imports venues that hosted >= MIN_EVENTS non-cancelled events, carrying
// over neighborhood, address, and coordinates from the event rows. Entries
// are tagged 'Smileys venue' and get a purely factual description ("has
// hosted N Smileys events since <month year>") — no invented copy, so
// these rows don't repeat the seeded-placeholder problem that
// cleanup-seed-directory.ts had to purge.
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

const MIN_EVENTS  = 2
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
    select: { location: true, neighborhood: true, address: true, lat: true, lng: true, date: true },
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

  let created = 0, skippedExisting = 0
  const planned: string[] = []

  for (const [name, evs] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (evs.length < MIN_EVENTS) continue
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

    planned.push(
      `+ ${name}  [${category}] ${neighborhood ?? '—'} · ${evs.length} events` +
      `${address ? ' · addr ✓' : ''}${lat != null ? ' · coords ✓' : ''}`
    )

    if (write) {
      await prisma.business.create({
        data: {
          name, category, description,
          neighborhood, address,
          latitude: lat, longitude: lng,
          isExpatFriendly: true,
          isApproved: true, isActive: true,
          submittedById: admin?.id ?? null,
          tags: ['We meet here'],
        },
      })
      created++
    }
  }

  console.log('\n' + planned.join('\n'))
  console.log(
    write
      ? `\n✓ Created ${created} businesses (${skippedExisting} already existed)`
      : `\nDRY RUN — would create ${planned.length} businesses (${skippedExisting} already exist). Re-run with --write to insert.`
  )
}

main().finally(() => prisma.$disconnect())
