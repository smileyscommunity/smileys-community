// Launch a city's starter club lineup from the shared template catalog.
//
//   npx tsx --env-file=.env scripts/launch-city-clubs.ts <city-slug>
//
// The city must already exist (cities row). Idempotent — re-running only
// creates clubs that don't exist yet. See lib/clubTemplates.ts for the lineup
// and lib/seedCityClubs.ts for the seeding logic.

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { seedCityClubs } from '../lib/seedCityClubs'

const citySlug = process.argv[2]
if (!citySlug) {
  console.error('Usage: npx tsx --env-file=.env scripts/launch-city-clubs.ts <city-slug>')
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0])

seedCityClubs(prisma, citySlug)
  .then(async (r) => {
    console.log(`✓ ${r.city}: ${r.created} clubs created, ${r.skipped} already existed (of ${r.total})`)
    for (const s of r.createdSlugs) console.log(`   + /clubs/${s}`)
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (e: unknown) => {
    console.error('✗', e instanceof Error ? e.message : e)
    await prisma.$disconnect()
    process.exit(1)
  })
