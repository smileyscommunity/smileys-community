// Repair member `neighborhood` values that don't match any ACTIVE neighborhood
// of the member's own city.
//
// Why it matters: every neighborhood feature validates against the city's
// registry, so a member whose value fails that check is invisible to all of
// them — their own neighborhood page, "members near you", neighborhood event
// matching. They look set up and are silently excluded.
//
// Three causes found on prod 2026-08-17 (33 rows):
//   • '' stored instead of NULL (21)          → NULL
//   • diacritics stripped or wrong casing (10) → the registry's canonical name
//     ('Beyoglu' → 'Beyoğlu', 'sarıyer' → 'Sarıyer')
//   • another city's neighborhood entirely (2) → left alone unless
//     CLEAR_UNMATCHED=1 (two Antalya members set to Istanbul districts; Antalya
//     has no neighborhoods seeded, so NULL is the only honest value)
//
// Matching is by normalized comparison against the member's OWN city registry,
// not a hardcoded name map: it fixes casing and diacritics in one pass and
// cannot invent a neighborhood the city doesn't have. A normalized form that
// matches two or more rows is reported and skipped rather than guessed.
//
// Every write is guarded on the exact value read (`WHERE id AND neighborhood`),
// so a concurrent edit by the member wins and a re-run is a no-op.
//
// Run on the server with both env files:
//   npx tsx --env-file=.env --env-file=.env.local scripts/fix-member-neighborhoods.ts
// DRY_RUN=1 prints the plan and writes nothing. CLEAR_UNMATCHED=1 additionally
// NULLs values with no match in their city.
import { prisma } from '@/lib/prisma'
import { classifyNeighborhoodValue } from '@/lib/neighborhoodsDb'

const DRY_RUN         = process.env.DRY_RUN === '1'
const CLEAR_UNMATCHED = process.env.CLEAR_UNMATCHED === '1'

type Plan = { id: string; name: string; city: string; from: string; to: string | null; why: string }

async function main() {
  const cities = await prisma.city.findMany({ select: { id: true, slug: true } })
  // One registry lookup per city, not per member.
  const registry = new Map<string, { name: string }[]>()
  for (const c of cities) {
    registry.set(c.id, await prisma.neighborhood.findMany({
      where:  { cityId: c.id, active: true },
      select: { name: true },
    }))
  }

  const members = await prisma.user.findMany({
    where:  { neighborhood: { not: null }, cityId: { not: undefined } },
    select: { id: true, name: true, cityId: true, neighborhood: true },
  })

  const fix: Plan[] = []
  const unmatched: Plan[] = []
  const ambiguous: Plan[] = []
  let alreadyValid = 0

  for (const m of members) {
    const value = m.neighborhood ?? ''
    const rows  = registry.get(m.cityId) ?? []
    const city  = cities.find(c => c.id === m.cityId)?.slug ?? m.cityId

    if (rows.some(r => r.name === value)) { alreadyValid++; continue }

    const base = { id: m.id, name: m.name, city, from: value }

    if (value.trim() === '') {
      fix.push({ ...base, to: null, why: 'empty string → NULL' })
      continue
    }

    // Same classifier the weekly scan and the write paths use, so "fixable"
    // means one thing across all three.
    const verdict = await classifyNeighborhoodValue(m.cityId, value)
    if (verdict.kind === 'canonical') {
      fix.push({ ...base, to: verdict.name, why: 'canonical spelling in this city' })
    } else if (verdict.kind === 'ambiguous') {
      ambiguous.push({ ...base, to: null, why: `${verdict.matches.length} registry rows fold to the same form` })
    } else {
      unmatched.push({ ...base, to: null, why: `no neighborhood of ${city} matches` })
    }
  }

  console.log(`→ ${members.length} members with a neighborhood set; ${alreadyValid} already valid${DRY_RUN ? '  (DRY RUN)' : ''}`)
  console.log(`→ ${fix.length} to fix, ${unmatched.length} unmatched, ${ambiguous.length} ambiguous\n`)

  const show = (label: string, rows: Plan[]) => {
    if (!rows.length) return
    console.log(label)
    for (const r of rows) {
      console.log(`   ${r.city.padEnd(9)} ${r.name.padEnd(22)} ${JSON.stringify(r.from).padEnd(18)} → ${r.to === null ? 'NULL' : JSON.stringify(r.to)}   (${r.why})`)
    }
    console.log('')
  }

  show('FIX:', fix)
  show(CLEAR_UNMATCHED ? 'UNMATCHED → NULL (CLEAR_UNMATCHED=1):' : 'UNMATCHED (left alone; CLEAR_UNMATCHED=1 to NULL these):', unmatched)
  show('AMBIGUOUS (never guessed — fix the registry or the member by hand):', ambiguous)

  const writes = CLEAR_UNMATCHED ? [...fix, ...unmatched] : fix
  if (DRY_RUN) {
    console.log(`✓ dry run — ${writes.length} row(s) would change`)
    return
  }

  let changed = 0, raced = 0
  for (const w of writes) {
    // Guarded on the value we read: if the member edited their profile between
    // the read and here, their choice wins and this is a no-op.
    const res = await prisma.user.updateMany({
      where: { id: w.id, neighborhood: w.from },
      data:  { neighborhood: w.to },
    })
    if (res.count === 1) changed++
    else raced++
  }
  console.log(`✓ ${changed} row(s) updated${raced ? `, ${raced} skipped (value changed under us / already fixed)` : ''}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
