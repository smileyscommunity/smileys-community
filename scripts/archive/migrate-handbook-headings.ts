// One-off content migration: promote the Handbook's fake section headings to
// real ones. The transform itself lives in lib/handbook-headings so it can be
// unit-tested against the real corpus without a database (see
// tests/handbook-headings.test.ts); this script is only the DB driver.
//
// Dry run by default — prints exactly what it would change and writes nothing:
//   npx tsx --env-file=.env --env-file=.env.local scripts/migrate-handbook-headings.ts
// Apply for real:
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/migrate-handbook-headings.ts
import { prisma } from '../../lib/prisma'
import { migrateHeadings } from '../../lib/handbook-headings'

const APPLY = process.env.APPLY === '1'

async function main() {
  console.log(APPLY ? '⚠️  APPLY MODE — writing to the database\n' : '🔍 DRY RUN — no writes (set APPLY=1 to commit)\n')

  const articles = await prisma.post.findMany({
    where:   { kind: 'handbook' },
    orderBy: { slug: 'asc' },
    select:  { id: true, slug: true, title: true, body: true },
  })

  let totalChanged = 0
  let totalHeadings = 0

  for (const a of articles) {
    const { body, changes } = migrateHeadings(a.body)
    if (changes.length === 0) {
      console.log(`· ${a.slug} — no change`)
      continue
    }
    totalChanged++
    totalHeadings += changes.length
    const h2 = changes.filter(c => c.level === 2).length
    const h3 = changes.filter(c => c.level === 3).length
    console.log(`\n▸ ${a.slug}  (+${h2} h2, +${h3} h3)`)
    for (const c of changes) console.log(`    <h${c.level}>${c.text}</h${c.level}>`)

    if (APPLY) {
      // Guarded on the exact prior body: if anyone edited the article between
      // the dry run and the apply, this updates nothing rather than clobbering
      // their work. updateMany (not update) so a 0-row result is not an error.
      const res = await prisma.post.updateMany({
        where: { id: a.id, body: a.body },
        data:  { body },
      })
      if (res.count === 0) console.log('    ⚠️  SKIPPED — article changed since it was read; re-run')
    }
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Articles with changes: ${totalChanged}/${articles.length} · headings promoted: ${totalHeadings}`)
  if (!APPLY && totalChanged > 0) console.log('Re-run with APPLY=1 to commit.')
  // updatedAt moves on write, but lastReviewedAt is deliberately NOT touched —
  // restructuring markup is not a factual review of the content.
  if (APPLY) console.log('Remember: revalidate the handbook cache (next deploy or a staff edit) for readers to see it.')
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
