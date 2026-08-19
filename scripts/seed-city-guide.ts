import { prisma } from '@/lib/prisma'
import { validateGuideEntry, guideEntryPayload } from '@/lib/guideEntryInput'
import { readFileSync } from 'fs'

// Seed a city's guide experiences from a JSON file — the generic version of
// what Bodrum needed four bespoke scripts for (history, water, table, takes).
// One tool, any city, and it runs entries through the SAME validateGuideEntry
// the admin panel editor uses, so a script-seeded entry can never be a shape
// the panel couldn't have produced (that divergence is how Bodrum got a mood
// from Istanbul's vocabulary seeded into prod).
//
// Usage (on the server, per CLAUDE.md conventions):
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/seed-city-guide.ts <citySlug> <entries.json>
//   ...review the plan, then rerun without DRY_RUN=1.
//
// The JSON file is an array of entries in the panel editor's draft shape:
//   [{ "slug": "sunset-at-the-castle", "title": "Sunset at the castle",
//      "emoji": "🌅", "tagline": "...", "collection": "sunset",
//      "moods": ["romantic"], "seasons": ["summer"], "neighborhoods": ["Old Town"],
//      "cost": "free", "time": "1 hour", "when": "golden hour",
//      "why": "...", "take": "...", "sections": [], "photo": null,
//      "firstTime": true, "status": "draft", "sortOrder": 0 }, ...]
//
// Entries land as DRAFTS unless the file says published — and published
// requires a non-empty Take (validateGuideEntry enforces it), same as the
// panel. Idempotent: an entry whose slug already exists for the city is
// skipped, never overwritten — the panel owns edits after the first seed.

const DRY_RUN = process.env.DRY_RUN === '1'

async function main() {
  const [citySlug, file] = process.argv.slice(2)
  if (!citySlug || !file) {
    console.error('Usage: [DRY_RUN=1] tsx scripts/seed-city-guide.ts <citySlug> <entries.json>')
    process.exit(1)
  }

  const city = await prisma.city.findUnique({ where: { slug: citySlug }, select: { id: true, name: true } })
  if (!city) { console.error(`City not found: ${citySlug}`); process.exit(1) }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`Could not read/parse ${file}: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }
  if (!Array.isArray(raw)) { console.error('File must be a JSON array of entries'); process.exit(1) }

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Seeding ${raw.length} guide entries for ${city.name} (${citySlug})\n`)

  let created = 0, skipped = 0, invalid = 0
  for (const [i, item] of raw.entries()) {
    // The same validation the panel runs — per-city collections/moods/seasons/
    // neighborhoods, slug shape, Take required when publishing.
    const result = await validateGuideEntry(item, { cityId: city.id, citySlug })
    if (!result.ok) {
      invalid++
      console.log(`  ✗ [${i}] ${(item as { slug?: string })?.slug ?? '(no slug)'} — ${result.error}`)
      continue
    }
    const v = result.value

    const existing = await prisma.guideEntry.findFirst({
      where:  { cityId: city.id, kind: 'experience', slug: v.slug },
      select: { id: true },
    })
    if (existing) {
      skipped++
      console.log(`  = ${v.slug} (already present — panel owns edits after first seed)`)
      continue
    }

    if (!DRY_RUN) {
      await prisma.guideEntry.create({
        data: { cityId: city.id, kind: 'experience', ...guideEntryPayload(v) },
      })
    }
    created++
    console.log(`  + ${v.slug} (${v.status})`)
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] would create' : 'Created'} ${created} · skipped ${skipped} existing · ${invalid} invalid`)
  if (invalid > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
