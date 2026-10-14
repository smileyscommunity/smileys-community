// Propose cover photos for directory businesses that don't have one,
// using the cover image of the most recent non-cancelled event held at
// that venue (matched by location name, same alias convention as
// scripts/import-event-venues.ts). Factual by construction — the photo
// is one the community already published for an event at that venue.
//
// Matching is city-scoped: a business only takes photos from events in
// its own city, so a same-named venue in another city can never donate
// its picture across cities.
//
// Default mode is dry-run (prints business ← event/date/image). Re-run
// with --write to apply; idempotent — only fills NULL covers, so a
// manually-set or claimed-owner photo is never overwritten.
//
// Run on prod:
//   ssh root@<server> 'cd /root/smileys-community && \
//     npx tsx --env-file=.env scripts/propose-directory-covers.ts'          # dry run
//   ssh root@<server> 'cd /root/smileys-community && \
//     npx tsx --env-file=.env scripts/propose-directory-covers.ts --write'  # apply

import { prisma } from '@/lib/prisma'
import { normVenue } from '@/lib/venueEventCover'

const norm = normVenue
// City + normalized venue name — the map key that keeps matching per-city.
const key = (cityId: string, name: string) => `${cityId}\0${norm(name)}`

async function main() {
  const write = process.argv.includes('--write')

  const businesses = await prisma.business.findMany({
    where:  { isActive: true, coverImage: null },
    select: { id: true, name: true, cityId: true },
    orderBy: { name: 'asc' },
  })
  if (!businesses.length) { console.log('Every active business already has a cover.'); return }

  // Newest first, so byLoc.get(...)[0] is the venue's most recent photo.
  const events = await prisma.event.findMany({
    where:   { coverImage: { not: null }, cancelledAt: null },
    select:  { location: true, coverImage: true, date: true, title: true, cityId: true },
    orderBy: { date: 'desc' },
  })
  const byLoc = new Map<string, typeof events>()
  for (const e of events) {
    if (!norm(e.location)) continue
    const k = key(e.cityId, e.location)
    if (!byLoc.has(k)) byLoc.set(k, [])
    byLoc.get(k)!.push(e)
  }

  let planned = 0, applied = 0, unmatched = 0
  for (const b of businesses) {
    const evs = byLoc.get(key(b.cityId, b.name))
    if (!evs?.length) { unmatched++; continue }
    const pick = evs[0]
    planned++
    console.log(`${write ? '→' : '·'} ${b.name}\n    ← "${pick.title}" (${pick.date})  ${pick.coverImage}`)
    if (write) {
      const res = await prisma.business.updateMany({
        where: { id: b.id, coverImage: null },
        data:  { coverImage: pick.coverImage },
      })
      applied += res.count
    }
  }

  console.log(
    write
      ? `\n✓ Applied ${applied} covers (${unmatched} businesses had no matching event photo)`
      : `\nDRY RUN — would set ${planned} covers; ${unmatched} of ${businesses.length} cover-less businesses have no matching event photo. Re-run with --write.`
  )
}

main().finally(() => prisma.$disconnect())
