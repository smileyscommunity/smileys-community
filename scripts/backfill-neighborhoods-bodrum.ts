// Backfill the editorial fields on Bodrum's original eight neighborhoods.
//
// They were seeded with a name, emoji and coordinates but no `vibe` and no
// `area`, so once seed-neighborhoods-bodrum.ts added the rest of the peninsula
// the list read as two different hands: seven rows with a description and a
// coast grouping, eight with blanks. Nothing was broken — an empty `area`
// renders as "no grouping" by design — it just looked half-finished.
//
// Touches ONLY `vibe`, `area` and (for two rows) `cost`. Names, emojis,
// slugs and coordinates are left exactly as they are: they're live, members
// may already have picked them, and the emoji choices are someone's call, not
// this script's.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/backfill-neighborhoods-bodrum.ts
// DRY_RUN=1 prints the diff without writing.
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'

// Matched by name — the same key seed-neighborhoods-bodrum.ts skips on.
// `cost` is the 1–3 tier Istanbul uses. Everything landed on 2, which carries
// no signal; Yalıkavak and Türkbükü are the peninsula's expensive corners
// (superyacht marina, beach clubs) and are the only two rows whose cost moves.
const BACKFILL: { name: string; vibe: string; area: string; cost: number }[] = [
  { name: 'Bodrum Merkez', vibe: 'Castle, marina & old town',     area: 'Town',        cost: 2 },
  { name: 'Gümbet',        vibe: 'Beach bars & nightlife',        area: 'South Coast', cost: 2 },
  { name: 'Bitez',         vibe: 'Quiet bay & tangerine groves',  area: 'South Coast', cost: 2 },
  { name: 'Ortakent',      vibe: 'Long sandy beach',              area: 'South Coast', cost: 2 },
  { name: 'Turgutreis',    vibe: 'Marina & sunset promenade',     area: 'West Coast',  cost: 2 },
  { name: 'Yalıkavak',     vibe: 'Superyacht marina & upscale',   area: 'North Coast', cost: 3 },
  { name: 'Gündoğan',      vibe: 'Calm bay & olive groves',       area: 'North Coast', cost: 2 },
  { name: 'Türkbükü',      vibe: 'Beach clubs & seen-to-be-seen', area: 'North Coast', cost: 3 },
]

async function main() {
  const bodrum = await prisma.city.findUnique({ where: { slug: 'bodrum' }, select: { id: true, name: true } })
  if (!bodrum) {
    console.error('✗ bodrum city row missing')
    process.exit(1)
  }

  console.log(`→ ${BACKFILL.length} rows to reconcile in ${bodrum.name}${DRY_RUN ? ' — DRY RUN, nothing will be written' : ''}`)

  let changed = 0, already = 0, missing = 0
  for (const b of BACKFILL) {
    const row = await prisma.neighborhood.findUnique({
      where:  { cityId_name: { cityId: bodrum.id, name: b.name } },
      select: { id: true, vibe: true, area: true, cost: true },
    })
    if (!row) {
      // Renamed or removed since this list was written — say so rather than
      // silently creating a duplicate under the old name.
      console.log(`  ? ${b.name} — no such row, skipped`)
      missing++
      continue
    }

    const diffs: string[] = []
    if ((row.vibe ?? '') !== b.vibe) diffs.push(`vibe "${row.vibe ?? ''}" → "${b.vibe}"`)
    if ((row.area ?? '') !== b.area) diffs.push(`area "${row.area ?? ''}" → "${b.area}"`)
    if (row.cost !== b.cost)         diffs.push(`cost ${row.cost} → ${b.cost}`)

    if (diffs.length === 0) { already++; console.log(`  = ${b.name} (already correct)`); continue }

    if (!DRY_RUN) {
      await prisma.neighborhood.update({
        where: { id: row.id },
        data:  { vibe: b.vibe, area: b.area, cost: b.cost },
      })
    }
    console.log(`  ~ ${b.name}: ${diffs.join(', ')}`)
    changed++
  }

  console.log(`✓ ${DRY_RUN ? 'would update' : 'updated'} ${changed}, ${already} already correct, ${missing} not found`)
}

main().finally(() => prisma.$disconnect())
