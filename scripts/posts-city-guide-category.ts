// Fold the retired per-city story categories into 'City Guide'.
//
// "Istanbul Guide" and "Antalya Guide" were the taxonomy naming two of seven
// cities; the category is now one 'City Guide' and the public pages label the
// city from the post's cityId. The write paths already normalise on save;
// this moves the rows that nobody has edited since.
//
// Idempotent: each update is guarded on the current value. Default is a dry
// run; DRY_RUN=0 applies.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/posts-city-guide-category.ts
//   DRY_RUN=0 npx tsx --env-file=.env --env-file=.env.local scripts/posts-city-guide-category.ts
import { prisma } from '../lib/prisma'

const LEGACY = ['Istanbul Guide', 'Antalya Guide']
const DRY_RUN = process.env.DRY_RUN !== '0'

async function main() {
  const rows = await prisma.post.findMany({
    where:  { category: { in: LEGACY } },
    select: { id: true, slug: true, category: true, cityId: true, kind: true },
  })
  console.log(`${rows.length} row(s) under a legacy city-guide category${DRY_RUN ? ' (DRY RUN — nothing written)' : ''}`)
  for (const r of rows) {
    console.log(`  ${r.slug}  ${r.category} → City Guide  cityId=${r.cityId ?? '—'}  kind=${r.kind}`)
    if (DRY_RUN) continue
    const res = await prisma.post.updateMany({
      where: { id: r.id, category: r.category },
      data:  { category: 'City Guide' },
    })
    if (res.count !== 1) console.log(`    skipped (changed underneath)`)
  }
  // A guide with no city has no label; say so rather than fixing it silently.
  const unpinned = rows.filter(r => !r.cityId)
  if (unpinned.length) {
    console.log(`\n${unpinned.length} guide(s) have no cityId and will read as plain "City Guide" — pin them in /admin/posts:`)
    for (const r of unpinned) console.log(`  ${r.slug}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
