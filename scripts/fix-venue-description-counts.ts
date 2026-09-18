// The venue importer (scripts/import-event-venues.ts) wrote an event count
// into each description — "…has hosted 8 Smileys events since June 2026." —
// and it went stale (Dozze says 8; its page counts 15). Rewrites exactly
// that sentence, and only where the description still reads as the importer
// wrote it; anything an owner or admin edited is left alone.
//
//   (default)  DRY RUN — prints each change, writes nothing
//   APPLY=1    writes them, guarded on the old text
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/fix-venue-description-counts.ts

import { prisma } from '@/lib/prisma'

const APPLY = process.env.APPLY === '1'
const PATTERN = / — has hosted \d+ Smileys events? since ([A-Z][a-z]+ \d{4})\./

async function main() {
  console.log(APPLY ? 'APPLY — writing\n' : 'DRY RUN — nothing is written. APPLY=1 writes.\n')
  const rows = await prisma.business.findMany({
    where:  { description: { contains: 'Smileys event' } },
    select: { id: true, name: true, description: true },
  })
  let changed = 0
  for (const r of rows) {
    const m = PATTERN.exec(r.description)
    if (!m) continue
    const next = r.description.replace(PATTERN, `, hosting Smileys events since ${m[1]}.`)
    console.log(`  ${r.name}\n    - ${r.description}\n    + ${next}`)
    if (APPLY) {
      const { count } = await prisma.business.updateMany({ where: { id: r.id, description: r.description }, data: { description: next } })
      changed += count
    } else changed++
  }
  console.log(`\n${APPLY ? 'Rewrote' : 'Would rewrite'} ${changed} description${changed === 1 ? '' : 's'}.`)
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
