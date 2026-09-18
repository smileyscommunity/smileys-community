// Link events whose venue was typed differently from its directory listing.
//
// Migration 20260918000002_event_business backfilled Event.businessId by exact
// venue name. What it can't catch is below: spellings checked by hand against
// the listing's name, city and neighbourhood (2026-09-18). Some of these
// events matched a PENDING duplicate stub exactly ("DOZZE KADIKÖY", "Spice
// Corner" — stubs the event form filed next to a live listing); they are
// re-pointed at the live one.
//
// Idempotent: each write is guarded on the link it read. DRY RUN by default.
//   npx tsx --env-file=.env --env-file=.env.local scripts/link-event-venues.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/link-event-venues.ts

import { prisma } from '@/lib/prisma'

const APPLY = process.env.APPLY === '1'

// city slug → (typed venue, whitespace-collapsed + lowercased) → listing name
const MAP: Record<string, Record<string, string>> = {
  istanbul: {
    'dozze':                               'Dozze Kadıköy',
    'dozze kadıköy':                       'Dozze Kadıköy',
    'roastary coffee':                     'Roastory Coffee',
    'roastory coffee co istiklal caddesi': 'Roastory Coffee',
    'spice corner':                        'Spice Corner Indian Restaurant',
    'straborn cafe':                       'Straborn Coffee AKM Taksim',
  },
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

async function main() {
  let planned = 0, written = 0
  for (const [slug, map] of Object.entries(MAP)) {
    const city = await prisma.city.findUnique({ where: { slug }, select: { id: true } })
    if (!city) { console.log(`! no city ${slug}`); continue }
    const targets = await prisma.business.findMany({
      where:  { cityId: city.id, name: { in: [...new Set(Object.values(map))] } },
      select: { id: true, name: true, isApproved: true, isActive: true },
    })
    const byName = new Map(targets.map(t => [t.name, t]))
    const events = await prisma.event.findMany({
      where:  { cityId: city.id },
      select: { id: true, title: true, date: true, location: true, businessId: true },
    })
    for (const e of events) {
      const want = map[norm(e.location)]
      if (!want) continue
      const biz = byName.get(want)
      if (!biz) { console.log(`! no listing "${want}" in ${slug}`); continue }
      if (e.businessId === biz.id) continue
      planned++
      console.log(`  ${e.date} ${e.title} — "${e.location}" → ${biz.name}${biz.isApproved && biz.isActive ? '' : ' (not live)'}${e.businessId ? ` (was ${e.businessId})` : ''}`)
      if (APPLY) {
        const { count } = await prisma.event.updateMany({ where: { id: e.id, businessId: e.businessId }, data: { businessId: biz.id } })
        written += count
      }
    }
  }
  console.log(`\n${APPLY ? `Linked ${written} of ${planned}` : `Would link ${planned}`} events.`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
