// Seed the interest → vibe-tag mapping that powers the "Your First Event"
// matcher. Members pick TOPIC interests (sailing, dining, games…) while events
// are tagged by VIBE (Social, Chill, Adventure…); this map bridges the two.
//
//   npx tsx --env-file=.env scripts/seed-interest-tags.ts
//
// Idempotent (skipDuplicates) — safe to re-run. Needed because deploy.sh uses
// `prisma db push`, which creates the table but does NOT run migration seeds.
// Keep in sync with prisma/migrations/20260705000001_add_interest_tag_map.

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0])

// interest (lowercase, from app/admin/applications) → stable t_* tag id.
const MAP: Array<[string, string]> = [
  ['social',     't_social'],
  ['dining',     't_food'],
  ['wellness',   't_wellness'],
  ['networking', 't_networking'],
  ['outdoor',    't_outdoor'],
  ['outdoor',    't_adventure'],
  ['languages',  't_learning'],
  ['languages',  't_cultural'],
  ['sailing',    't_adventure'],  // approx — no topic tag
  ['sailing',    't_outdoor'],
  ['games',      't_social'],     // approx
]

async function main() {
  // Guard: every referenced tag must exist, or the FK insert fails. Surface a
  // clear message rather than a raw constraint error.
  const needed = [...new Set(MAP.map(([, t]) => t))]
  const found = await prisma.tag.findMany({ where: { id: { in: needed } }, select: { id: true } })
  const missing = needed.filter(id => !found.some(f => f.id === id))
  if (missing.length) {
    console.error(`✗ Missing tag ids (seed the base tags first): ${missing.join(', ')}`)
    process.exit(1)
  }

  const res = await prisma.interestTagMap.createMany({
    data: MAP.map(([interest, tagId]) => ({ interest, tagId })),
    skipDuplicates: true,
  })
  const total = await prisma.interestTagMap.count()
  console.log(`✓ interest_tag_map: +${res.count} new row(s), ${total} total`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
