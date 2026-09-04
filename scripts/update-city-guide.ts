import { prisma } from '@/lib/prisma'
import { validateGuideEntry, guideEntryPayload } from '@/lib/guideEntryInput'
import { readFileSync } from 'fs'
import { writeAudit, SCRIPT_ACTOR } from '@/lib/audit'

// Re-sync a city's EXISTING guide entries from their draft file — the step
// seed-city-guide.ts deliberately refuses ("panel owns edits after first
// seed"), for the one case where the file really is the source of truth
// again: a fact-check on the seeded text.
//
// Ankara's fifteen entries went live, an adversarial check found eleven
// wrong facts (a festival date from last year, a döner described backwards,
// Atatürk arriving by a train that didn't run), and the fixes were made in
// the file they came from. Fifteen hand-edits in the panel would have been
// the alternative, and fifteen chances to paste the wrong paragraph.
//
// Usage (on the server, per CLAUDE.md conventions):
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local \
//     scripts/update-city-guide.ts <citySlug> <entries.json> [slug,slug,...]
//   ...review the per-field plan, then rerun without DRY_RUN=1.
//
// What it touches: the editorial fields — title, emoji, tagline, collection,
// moods, seasons, cost, time, when, neighborhoods, firstTime, and the why /
// take / sections inside `content`. Every entry still goes through the same
// validateGuideEntry the panel uses.
//
// What it never touches, on purpose:
//   · status    — a fact fix must not unpublish, and must not publish a draft
//   · sortOrder — shelf order is the panel's call
//   · photo     — someone may have set one in the panel since the seed; the
//                 file's null would wipe it
//   · lastReviewedAt — a corrected fact is still an unreviewed one until a
//                 person on the ground checks it
// An entry in the file that does NOT exist yet is reported and skipped:
// creating is seed-city-guide's job, and the two should stay distinct so
// neither can do the other's damage by accident.

const DRY_RUN = process.env.DRY_RUN === '1'

type Content = { why?: unknown; take?: unknown; sections?: unknown; photo?: unknown }

const EDITORIAL = ['title', 'emoji', 'tagline', 'collection', 'moods', 'seasons', 'cost', 'time', 'when', 'neighborhoods', 'firstTime'] as const

// jsonb does not keep object key order — it sorts keys by length, then
// bytewise — so a `sections` block written as { title, items } reads back as
// { items, title }. Plain JSON.stringify would call every entry changed.
function canon(v: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sort)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as object).sort().map(k => [k, sort((x as Record<string, unknown>)[k])]))
    : x
  return JSON.stringify(sort(v ?? null))
}

function same(a: unknown, b: unknown): boolean {
  return canon(a) === canon(b)
}

async function main() {
  const [citySlug, file, only] = process.argv.slice(2)
  if (!citySlug || !file) {
    console.error('Usage: [DRY_RUN=1] tsx scripts/update-city-guide.ts <citySlug> <entries.json> [slug,slug,...]')
    process.exit(1)
  }
  const city = await prisma.city.findUnique({ where: { slug: citySlug }, select: { id: true, name: true } })
  if (!city) { console.error(`City not found: ${citySlug}`); process.exit(1) }

  let raw: unknown
  try { raw = JSON.parse(readFileSync(file, 'utf8')) }
  catch (e) { console.error(`Could not read/parse ${file}: ${e instanceof Error ? e.message : e}`); process.exit(1) }
  if (!Array.isArray(raw)) { console.error('File must be a JSON array of entries'); process.exit(1) }

  const wanted = only ? new Set(only.split(',').map(s => s.trim()).filter(Boolean)) : null
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Re-syncing guide entries for ${city.name} (${citySlug}) from ${file}\n`)

  let updated = 0, unchanged = 0, missing = 0, invalid = 0
  const changedSlugs: string[] = []

  for (const [i, item] of raw.entries()) {
    const slug = (item as { slug?: string })?.slug
    if (wanted && (!slug || !wanted.has(slug))) continue

    const result = await validateGuideEntry(item, { cityId: city.id, citySlug })
    if (!result.ok) {
      invalid++
      console.log(`  ✗ [${i}] ${slug ?? '(no slug)'} — ${result.error}`)
      continue
    }
    const v = result.value
    const payload = guideEntryPayload(v)

    const existing = await prisma.guideEntry.findFirst({
      where:  { cityId: city.id, kind: 'experience', slug: v.slug },
      select: { id: true, title: true, emoji: true, tagline: true, collection: true, moods: true, seasons: true,
                cost: true, time: true, when: true, neighborhoods: true, firstTime: true, content: true, status: true },
    })
    if (!existing) {
      missing++
      console.log(`  ? ${v.slug} — not in ${city.name} yet; seed-city-guide.ts creates, this only updates`)
      continue
    }

    const before = (existing.content ?? {}) as Content
    const after  = payload.content
    const diffs: string[] = []
    for (const k of EDITORIAL) if (!same(existing[k], payload[k])) diffs.push(k)
    for (const k of ['why', 'take', 'sections'] as const) if (!same(before[k], after[k])) diffs.push(`content.${k}`)

    if (diffs.length === 0) { unchanged++; console.log(`  = ${v.slug}`); continue }

    console.log(`  ~ ${v.slug} (${existing.status}) — ${diffs.join(', ')}`)
    if (!DRY_RUN) {
      await prisma.guideEntry.update({
        where: { id: existing.id },
        data: {
          title: payload.title, emoji: payload.emoji, tagline: payload.tagline,
          collection: payload.collection, moods: payload.moods, seasons: payload.seasons,
          cost: payload.cost, time: payload.time, when: payload.when,
          neighborhoods: payload.neighborhoods, firstTime: payload.firstTime,
          // The photo is the panel's: keep whatever is there now.
          content: { why: after.why, take: after.take, sections: after.sections, photo: before.photo ?? after.photo ?? null },
        },
      })
    }
    updated++
    changedSlugs.push(v.slug)
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] would update' : 'Updated'} ${updated} · ${unchanged} unchanged · ${missing} not present · ${invalid} invalid`)
  if (!DRY_RUN && updated > 0) {
    await writeAudit(SCRIPT_ACTOR.id, SCRIPT_ACTOR.name, 'city.guide_update', city.id, 'city',
      { city: city.name, updated, unchanged, missing, invalid, slugs: changedSlugs.slice(0, 30), file },
      `Re-synced ${updated} guide entr${updated === 1 ? 'y' : 'ies'} in ${city.name} from file`,
    )
  }
  if (invalid > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
