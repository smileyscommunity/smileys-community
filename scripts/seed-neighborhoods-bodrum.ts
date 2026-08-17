// Fill out Bodrum's neighborhood list.
//
// Bodrum went live with eight rows covering the best-known places. Anywhere
// missing from that list is unpickable in every form in the product — profile,
// apply, board post, hangout, directory submit — and `safeNeighborhoodFor`
// nulls a name the city doesn't have, silently. This adds the rest of the
// peninsula. The list lives here rather than in lib/neighborhoods.ts: that
// module is Istanbul's legacy constant (NEIGHBORHOOD_META, still powering
// Istanbul's static guide content), and the DB is the source of truth for
// every other city.
//
// Idempotent: skips a name that already exists for the city, so re-running
// never duplicates and never clobbers admin edits made after the first run.
//   npx tsx --env-file=.env --env-file=.env.local scripts/seed-neighborhoods-bodrum.ts
// DRY_RUN=1 prints the plan without writing.
import { prisma } from '@/lib/prisma'
import { neighborhoodToSlug } from '@/lib/neighborhoods'

const DRY_RUN = process.env.DRY_RUN === '1'

// `area` is per-city free text (see lib/neighborhoodsDb.ts) — Istanbul's
// Central/European/Asian vocabulary describes a city split by a strait and
// says nothing useful about a peninsula, so Bodrum groups by coast.
//
// Order is the display order, continuing round the peninsula from the rows
// already live: south → west → north → east, inland last.
//
// Two places are deliberately absent. Bodrum's town centre is already live as
// 'Bodrum Merkez' (identical coordinates) and Türkbükü as 'Türkbükü' — adding
// 'Bodrum Town' and 'Göltürkbükü' would put two picker entries on one place,
// and the live names win because member rows may already reference them.
const BODRUM: { name: string; emoji: string; vibe: string; area: string; cost: number; lat: number; lon: number }[] = [
  { name: 'Gümbet',       emoji: '🎉', vibe: 'Beach bars & nightlife',          area: 'South Coast', cost: 2, lat: 37.0311, lon: 27.4103 },
  { name: 'Bitez',        emoji: '🌴', vibe: 'Quiet bay & tangerine groves',    area: 'South Coast', cost: 2, lat: 37.0347, lon: 27.3822 },
  { name: 'Ortakent',     emoji: '🏖️', vibe: 'Long sandy beach',                area: 'South Coast', cost: 2, lat: 37.0453, lon: 27.3489 },
  { name: 'Bağla',        emoji: '🐚', vibe: 'Small coves, few crowds',         area: 'South Coast', cost: 2, lat: 37.0083, lon: 27.3208 },
  { name: 'Akyarlar',     emoji: '🌊', vibe: 'Windsurf & clear water',          area: 'South Coast', cost: 2, lat: 36.9861, lon: 27.2861 },
  { name: 'Turgutreis',   emoji: '⛵', vibe: 'Marina & sunset promenade',       area: 'West Coast',  cost: 2, lat: 37.0089, lon: 27.2578 },
  { name: 'Gümüşlük',     emoji: '🐟', vibe: 'Fish tables & sunsets',           area: 'West Coast',  cost: 2, lat: 37.0517, lon: 27.2317 },
  { name: 'Yalıkavak',    emoji: '🛥️', vibe: 'Superyacht marina & upscale',     area: 'North Coast', cost: 3, lat: 37.1053, lon: 27.2925 },
  { name: 'Gündoğan',     emoji: '🫒', vibe: 'Calm bay & olive groves',         area: 'North Coast', cost: 2, lat: 37.1200, lon: 27.3333 },
  { name: 'Torba',        emoji: '🌅', vibe: 'Closest bay to town',             area: 'North Coast', cost: 2, lat: 37.0839, lon: 27.4139 },
  { name: 'Yalıçiftlik',  emoji: '🌾', vibe: 'Quiet, spread out, rural',        area: 'East',        cost: 1, lat: 37.0653, lon: 27.5322 },
  { name: 'Güvercinlik',  emoji: '✈️', vibe: 'Sheltered bay near the airport',  area: 'East',        cost: 1, lat: 37.1358, lon: 27.5386 },
  { name: 'Konacık',      emoji: '🛒', vibe: 'Everyday & residential',          area: 'Inland',      cost: 1, lat: 37.0369, lon: 27.3947 },
]

async function main() {
  const bodrum = await prisma.city.findUnique({ where: { slug: 'bodrum' }, select: { id: true, name: true, status: true } })
  if (!bodrum) {
    console.error('✗ bodrum city row missing')
    process.exit(1)
  }

  console.log(`→ ${BODRUM.length} neighborhoods for ${bodrum.name} (${bodrum.status})${DRY_RUN ? ' — DRY RUN, nothing will be written' : ''}`)

  // A name colliding with the city slug would be confusing rather than broken
  // ('Bodrum' -> 'bodrum', same as the city). Caught here so a later edit to
  // the list can't reintroduce it silently.
  for (const n of BODRUM) {
    if (neighborhoodToSlug(n.name) === 'bodrum') {
      console.error(`✗ "${n.name}" slugs to the city's own slug — rename it (e.g. "Bodrum Town")`)
      process.exit(1)
    }
  }

  // Append after the rows already there. Using this list's own index would
  // hand new rows sortOrder 3, 4, 6… — numbers the live eight already hold —
  // and scramble the picker's order for everyone.
  const maxOrder = (await prisma.neighborhood.aggregate({
    where: { cityId: bodrum.id },
    _max:  { sortOrder: true },
  }))._max.sortOrder ?? -1
  let nextOrder = maxOrder + 1

  let created = 0, existing = 0
  for (const n of BODRUM) {
    const found = await prisma.neighborhood.findUnique({
      where:  { cityId_name: { cityId: bodrum.id, name: n.name } },
      select: { id: true },
    })
    if (found) { existing++; console.log(`  = ${n.name} (already present)`); continue }
    const sortOrder = nextOrder++
    if (!DRY_RUN) {
      await prisma.neighborhood.create({
        data: {
          cityId:    bodrum.id,
          name:      n.name,
          slug:      neighborhoodToSlug(n.name),
          emoji:     n.emoji,
          vibe:      n.vibe,
          area:      n.area,
          cost:      n.cost,
          lat:       n.lat,
          lng:       n.lon,
          sortOrder,
        },
      })
    }
    console.log(`  + ${n.name} (${neighborhoodToSlug(n.name)}) [${n.area}] cost ${n.cost} @ ${n.lat},${n.lon} — sortOrder ${sortOrder}`)
    created++
  }

  console.log(`✓ ${DRY_RUN ? 'would create' : 'created'} ${created}, ${existing} already present`)
}

main().finally(() => prisma.$disconnect())
