// Report guide entries orphaned by vocabulary drift — the İzmir incident.
//
// A city's moods/collections live in lib/guide.ts and ship with deploys; its
// entries live in guide_entries and don't. When İzmir's vocabulary changed
// AFTER its entries were seeded, 7 published entries sat in shelves that no
// longer existed: invisible on /guide, zero errors anywhere. This scan is the
// alarm that was missing.
//
// For every city with guide entries, checks each PUBLISHED entry against that
// city's live vocabulary (collectionsFor/moodsFor) and reports:
//   · a collection that is not one of the city's collections
//   · any mood that is not one of the city's moods
//
// Report-only, no fixes. Exit 1 when orphans exist (0 clean) so it can gate.
//
// Usage (on the server, per CLAUDE.md conventions):
//   npx tsx --env-file=.env scripts/scan-guide-vocabulary.ts
import { prisma } from '@/lib/prisma'
import { collectionsFor, moodsFor } from '@/lib/guide'

async function main() {
  // Routes carry no taxonomy (collection null, moods []), so they pass through
  // the checks below untouched — no kind filter needed.
  const entries = await prisma.guideEntry.findMany({
    where:   { status: 'published' },
    select:  { slug: true, kind: true, collection: true, moods: true, city: { select: { slug: true, name: true } } },
    orderBy: [{ cityId: 'asc' }, { sortOrder: 'asc' }],
  })

  const byCity = new Map<string, { name: string; lines: string[] }>()
  let orphans = 0

  for (const e of entries) {
    const collections = new Set(collectionsFor(e.city.slug).map(c => c.value))
    const moods       = new Set(moodsFor(e.city.slug).map(m => m.value))

    const problems: string[] = []
    if (e.collection && !collections.has(e.collection)) problems.push(`collection "${e.collection}" not in city's collections`)
    for (const m of e.moods) {
      if (!moods.has(m)) problems.push(`mood "${m}" not in city's moods`)
    }
    if (problems.length === 0) continue

    orphans++
    const city = byCity.get(e.city.slug) ?? { name: e.city.name, lines: [] }
    for (const p of problems) city.lines.push(`  ✗ ${e.slug}${e.kind !== 'experience' ? ` (${e.kind})` : ''} — ${p}`)
    byCity.set(e.city.slug, city)
  }

  console.log(`Scanned ${entries.length} published guide entries across ${new Set(entries.map(e => e.city.slug)).size} cities\n`)

  if (orphans === 0) {
    console.log('✓ clean — every entry sits in its city\'s live vocabulary')
    return
  }

  for (const [slug, { name, lines }] of byCity) {
    console.log(`${name} (${slug}):`)
    for (const line of lines) console.log(line)
    console.log()
  }
  console.log(`✗ ${orphans} orphaned ${orphans === 1 ? 'entry' : 'entries'} — invisible on /guide right now`)
  console.log('NOTE: the fix is either remapping the entries onto the city\'s current vocabulary')
  console.log('      or extending the vocab in lib/guide.ts. A lib/guide.ts change for a live city')
  console.log('      must always be paired with a remap of that city\'s existing entries.')
  process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
