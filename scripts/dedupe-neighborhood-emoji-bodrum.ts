// Give every Bodrum neighborhood its own emoji.
//
// The list was seeded in two passes, and the two hands collided: four emoji
// were doing double duty across the fifteen rows (🌊 Bitez + Akyarlar, 🌾
// Ortakent + Yalıçiftlik, 🐚 Gündoğan + Bağla, 🌅 Turgutreis + Torba). In a
// picker where the emoji is the row's visual handle, a repeat reads as a
// duplicate entry.
//
// Deliberately minimal: only the four rows below move, and each replacement is
// taken from that row's own `vibe` text rather than from a house palette, so
// nothing here overrides a choice that was already working. The other eleven
// keep exactly what they had.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/dedupe-neighborhood-emoji-bodrum.ts
// DRY_RUN=1 prints the diff without writing.
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'

const MOVES: { name: string; from: string; to: string; why: string }[] = [
  { name: 'Bitez',    from: '🌊', to: '🍊', why: 'its vibe is the tangerine groves; 🌊 stays with Akyarlar\'s clear water' },
  { name: 'Ortakent', from: '🌾', to: '⛱️', why: 'its vibe is the long sandy beach; 🌾 stays with rural Yalıçiftlik' },
  { name: 'Gündoğan', from: '🐚', to: '🫒', why: 'its vibe is the olive groves; 🐚 stays with Bağla\'s coves' },
  { name: 'Torba',    from: '🌅', to: '🚤', why: 'closest bay to town — a hop; 🌅 stays with Turgutreis\'s sunset promenade' },
]

async function main() {
  const bodrum = await prisma.city.findUnique({ where: { slug: 'bodrum' }, select: { id: true, name: true } })
  if (!bodrum) {
    console.error('✗ bodrum city row missing')
    process.exit(1)
  }

  console.log(`→ ${MOVES.length} emoji to free up in ${bodrum.name}${DRY_RUN ? ' — DRY RUN, nothing will be written' : ''}`)

  let changed = 0, skipped = 0
  for (const m of MOVES) {
    const row = await prisma.neighborhood.findUnique({
      where:  { cityId_name: { cityId: bodrum.id, name: m.name } },
      select: { id: true, emoji: true },
    })
    if (!row) { console.log(`  ? ${m.name} — no such row, skipped`); skipped++; continue }
    if (row.emoji === m.to)   { console.log(`  = ${m.name} (already ${m.to})`); skipped++; continue }
    // Only move an emoji that is still the one this script expects. If someone
    // has since chosen something else by hand, that decision wins over this.
    if (row.emoji !== m.from) {
      console.log(`  ! ${m.name} is ${row.emoji}, not the expected ${m.from} — left alone`)
      skipped++
      continue
    }

    if (!DRY_RUN) {
      await prisma.neighborhood.update({ where: { id: row.id }, data: { emoji: m.to } })
    }
    console.log(`  ~ ${m.name}: ${m.from} → ${m.to}  (${m.why})`)
    changed++
  }

  // Prove the point rather than assume it: no emoji may appear twice.
  const all = await prisma.neighborhood.findMany({
    where:  { cityId: bodrum.id },
    select: { name: true, emoji: true },
    orderBy: { sortOrder: 'asc' },
  })
  const seen = new Map<string, string[]>()
  for (const n of all) {
    if (!n.emoji) continue
    seen.set(n.emoji, [...(seen.get(n.emoji) ?? []), n.name])
  }
  const dupes = [...seen.entries()].filter(([, names]) => names.length > 1)
  console.log(`✓ ${DRY_RUN ? 'would update' : 'updated'} ${changed}, ${skipped} skipped`)
  if (dupes.length && !DRY_RUN) {
    for (const [emoji, names] of dupes) console.log(`  ✗ ${emoji} still shared by: ${names.join(', ')}`)
    process.exit(1)
  }
  console.log(DRY_RUN
    ? `  (${dupes.length} duplicate emoji present right now)`
    : '  every neighborhood now has a unique emoji')
}

main().finally(() => prisma.$disconnect())
