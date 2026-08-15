// Migrate the repo-shipped guide JSON into guide_entries (phase 2.3).
//
// Idempotent: keyed on (cityId, kind, slug) — existing rows are SKIPPED, not
// overwritten, so re-running after a consul has edited content in the DB
// never clobbers their work. Slugs migrate verbatim: GuideSave/GuideTip rows
// key on them, and /guide/<slug> URLs must not break.
//
// Run on the server with both env files:
//   npx tsx --env-file=.env --env-file=.env.local scripts/migrate-guide-to-db.ts
// DRY_RUN=1 prints the plan without writing. The JSON stays in the repo as
// the default city's fallback (see lib/guideContent.ts) — do not delete it.
import { readFileSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'

async function main() {
  const istanbul = await prisma.city.findUnique({ where: { slug: 'istanbul' }, select: { id: true } })
  if (!istanbul) {
    console.error('✗ istanbul city row missing')
    process.exit(1)
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const expRaw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'guide-experiences.json'), 'utf8'))
  const routesRaw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'guide-routes.json'), 'utf8'))
  const experiences: any[] = expRaw.experiences ?? []
  const routes: any[] = routesRaw.routes ?? []
  /* eslint-enable @typescript-eslint/no-explicit-any */

  console.log(`→ ${experiences.length} experiences, ${routes.length} routes${DRY_RUN ? ' (dry run)' : ''}`)

  let created = 0, skipped = 0
  for (const [i, e] of experiences.entries()) {
    const found = await prisma.guideEntry.findUnique({
      where: { cityId_kind_slug: { cityId: istanbul.id, kind: 'experience', slug: e.slug } },
      select: { id: true },
    })
    if (found) { skipped++; continue }
    const { slug, title, emoji, collection, moods, tagline, cost, time, when, neighborhoods, firstTime,
            why, take, sections, handbook, directory, clubs } = e
    if (!DRY_RUN) {
      await prisma.guideEntry.create({
        data: {
          cityId: istanbul.id, kind: 'experience', slug, title,
          emoji: emoji ?? '✨', tagline: tagline ?? '',
          collection: collection ?? null, moods: moods ?? [],
          cost: cost ?? null, time: time ?? null, when: when ?? null,
          neighborhoods: neighborhoods ?? [], firstTime: !!firstTime,
          sortOrder: i,
          content: { why, take, sections, ...(handbook ? { handbook } : {}), ...(directory ? { directory } : {}), ...(clubs ? { clubs } : {}) },
        },
      })
    }
    console.log(`  + experience ${slug}`)
    created++
  }

  for (const [i, r] of routes.entries()) {
    const found = await prisma.guideEntry.findUnique({
      where: { cityId_kind_slug: { cityId: istanbul.id, kind: 'route', slug: r.slug } },
      select: { id: true },
    })
    if (found) { skipped++; continue }
    if (!DRY_RUN) {
      await prisma.guideEntry.create({
        data: {
          cityId: istanbul.id, kind: 'route', slug: r.slug, title: r.title,
          emoji: r.emoji ?? '🗺️', tagline: r.tagline ?? '',
          time: r.time ?? null, neighborhoods: r.neighborhoods ?? [],
          sortOrder: i,
          content: { intro: r.intro ?? '', stops: r.stops ?? [] },
        },
      })
    }
    console.log(`  + route ${r.slug}`)
    created++
  }

  console.log(`✓ ${created} created, ${skipped} already present`)
}

main().finally(() => prisma.$disconnect())
