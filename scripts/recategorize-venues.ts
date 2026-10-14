// One-off: move event-venue listings out of the "Other" catch-all into the
// categories added 2026-10 (Culture & Activities, Shop). Dry run by default.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/recategorize-venues.ts          # plan only
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/recategorize-venues.ts  # write
//
// Guards: an exact-name match inside one city, and the UPDATE only fires while the
// row is STILL in 'Other' (so a re-run, or a human who already moved it, is left
// alone). A snapshot of every row it will touch is written before any change.
// Büyük Kulüp (a private members' club with a pool) is deliberately not listed:
// which category fits is a human call.
import { writeFileSync } from 'fs'
import { prisma } from '../lib/prisma'
import { BUSINESS_CATEGORY_SET } from '../lib/directory-constants'

const MOVES: Array<{ name: string; to: string }> = [
  { name: 'Atatürk Cultural Center (AKM)',  to: 'Culture & Activities' },
  { name: 'Moda Sahnesi',                   to: 'Culture & Activities' },
  { name: 'Atlantis Fun City - Kadıköy',    to: 'Culture & Activities' },
  { name: 'Nazim Hikmet Kultur Merkezi',    to: 'Culture & Activities' },
  { name: 'Mozaik Studio',                  to: 'Culture & Activities' },
  { name: 'Harem Chocolate',                to: 'Shop' },
]
const CITY_SLUG = process.env.CITY_SLUG ?? 'istanbul'
const APPLY = process.env.APPLY === '1'

async function main() {
  for (const m of MOVES) if (!BUSINESS_CATEGORY_SET.has(m.to)) throw new Error(`Unknown category: ${m.to}`)
  const city = await prisma.city.findUnique({ where: { slug: CITY_SLUG }, select: { id: true } })
  if (!city) throw new Error(`No city ${CITY_SLUG}`)

  const plan: Array<{ id: string; name: string; from: string; to: string }> = []
  for (const m of MOVES) {
    const rows = await prisma.business.findMany({ where: { cityId: city.id, name: m.name }, select: { id: true, name: true, category: true } })
    if (rows.length !== 1) { console.log(`  skip "${m.name}": ${rows.length} rows match (need exactly 1)`); continue }
    const r = rows[0]
    if (r.category !== 'Other') { console.log(`  skip "${m.name}": already ${r.category}`); continue }
    plan.push({ id: r.id, name: r.name, from: r.category, to: m.to })
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${plan.length} listing(s):`)
  for (const p of plan) console.log(`  ${p.name}: ${p.from} → ${p.to}`)
  if (!APPLY || !plan.length) { if (!APPLY) console.log('Nothing written. Re-run with APPLY=1.'); return }

  const file = `${process.env.SNAPSHOT_DIR ?? '/root/db-backups'}/recategorize-venues-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify(plan, null, 2))
  console.log(`Snapshot: ${file}`)
  for (const p of plan) {
    const res = await prisma.business.updateMany({ where: { id: p.id, category: 'Other' }, data: { category: p.to } })
    console.log(`  ${p.name}: ${res.count ? 'moved' : 'unchanged (no longer Other)'}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
