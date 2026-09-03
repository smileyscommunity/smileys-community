import { prisma } from '@/lib/prisma'
import { writeAudit, SCRIPT_ACTOR } from '@/lib/audit'

// Publish a city's DRAFT guide entries in one go — the step after
// seed-city-guide.ts, once the drafts have been read and fact-checked.
//
// Usage (on the server, per CLAUDE.md conventions):
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/publish-city-guide.ts <citySlug> [slug,slug,...]
//   ...review the list, then rerun without DRY_RUN=1.
//
// Only rows currently in status 'draft' are touched (idempotent — a second
// run finds nothing). A draft with an empty Take is refused, the same rule the
// panel and validateGuideEntry enforce for publishing. The optional slug list
// limits the run; the default is every draft in the city. lastReviewedAt is
// left alone: publishing says "we stand by this", reviewing says "someone on
// the ground checked it", and only a human can do the second.

const DRY_RUN = process.env.DRY_RUN === '1'

async function main() {
  const [citySlug, only] = process.argv.slice(2)
  if (!citySlug) {
    console.error('Usage: [DRY_RUN=1] tsx scripts/publish-city-guide.ts <citySlug> [slug,slug,...]')
    process.exit(1)
  }
  const city = await prisma.city.findUnique({ where: { slug: citySlug }, select: { id: true, name: true } })
  if (!city) { console.error(`City not found: ${citySlug}`); process.exit(1) }

  const wanted = only ? only.split(',').map(s => s.trim()).filter(Boolean) : null
  const drafts = await prisma.guideEntry.findMany({
    where: { cityId: city.id, status: 'draft', ...(wanted ? { slug: { in: wanted } } : {}) },
    select: { id: true, slug: true, content: true },
    orderBy: { sortOrder: 'asc' },
  })
  if (wanted) {
    for (const s of wanted) if (!drafts.some(d => d.slug === s)) console.log(`  · ${s} — not a draft in ${city.name}, skipped`)
  }

  // The Take lives inside the `content` JSON with why/sections/photo.
  const takeOf  = (d: { content: unknown }) => {
    const c = d.content as { take?: unknown } | null
    return typeof c?.take === 'string' ? c.take.trim() : ''
  }
  const ready   = drafts.filter(d => takeOf(d))
  const noTake  = drafts.filter(d => !takeOf(d))
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Publishing ${ready.length} draft entr${ready.length === 1 ? 'y' : 'ies'} in ${city.name} (${citySlug})\n`)
  for (const d of ready)  console.log(`  ✓ ${d.slug}`)
  for (const d of noTake) console.log(`  ✗ ${d.slug} — empty Take, stays draft`)

  if (DRY_RUN || ready.length === 0) {
    console.log(`\n${DRY_RUN ? '[DRY RUN] would publish' : 'Nothing to publish:'} ${ready.length}`)
    return
  }
  const r = await prisma.guideEntry.updateMany({
    where: { id: { in: ready.map(d => d.id) }, status: 'draft' },
    data: { status: 'published' },
  })
  await writeAudit(SCRIPT_ACTOR.id, SCRIPT_ACTOR.name, 'city.guide_publish', city.id, 'city',
    { city: city.name, published: r.count, slugs: ready.map(d => d.slug).slice(0, 30) },
    `Published ${r.count} guide entr${r.count === 1 ? 'y' : 'ies'} in ${city.name}`,
  )
  console.log(`\nPublished ${r.count}`)
}

main().finally(() => prisma.$disconnect())
