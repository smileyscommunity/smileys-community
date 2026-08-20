// Seed the neighborhoods table from the legacy Istanbul constant.
//
// Idempotent: upserts on (cityId, name), so re-running never duplicates and
// never clobbers admin edits made after the first run (update only touches
// nothing — see below). Run on the server with both env files:
//   npx tsx --env-file=.env --env-file=.env.local scripts/seed-neighborhoods-istanbul.ts
// DRY_RUN=1 prints the plan without writing.
import { prisma } from '@/lib/prisma'
import { NEIGHBORHOOD_META, neighborhoodToSlug } from '@/lib/neighborhoods'

const DRY_RUN = process.env.DRY_RUN === '1'

async function main() {
  const istanbul = await prisma.city.findUnique({ where: { slug: 'istanbul' }, select: { id: true } })
  if (!istanbul) {
    console.error('✗ istanbul city row missing')
    process.exit(1)
  }

  const entries = Object.entries(NEIGHBORHOOD_META)
  console.log(`→ ${entries.length} neighborhoods from NEIGHBORHOOD_META${DRY_RUN ? ' (dry run)' : ''}`)

  let created = 0, existing = 0
  // sortOrder = position in the constant, so the DB ordering reproduces the
  // deliberate hand-curated grouping (Central hubs first, Islands last).
  for (const [i, [name, meta]] of entries.entries()) {
    const found = await prisma.neighborhood.findUnique({
      where: { cityId_name: { cityId: istanbul.id, name } },
      select: { id: true },
    })
    if (found) { existing++; continue }
    if (!DRY_RUN) {
      await prisma.neighborhood.create({
        data: {
          cityId:    istanbul.id,
          name,
          slug:      neighborhoodToSlug(name),
          emoji:     meta.emoji,
          vibe:      meta.vibe,
          area:      meta.side,
          cost:      meta.cost,
          lat:       meta.lat,
          lng:       meta.lon,
          sortOrder: i,
        },
      })
    }
    console.log(`  + ${name} (${neighborhoodToSlug(name)}) [${meta.side}]`)
    created++
  }

  console.log(`✓ ${created} created, ${existing} already present`)
}

main().finally(() => prisma.$disconnect())
