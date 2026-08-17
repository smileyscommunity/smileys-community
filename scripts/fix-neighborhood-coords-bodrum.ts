// Correct three Bodrum coordinates that were seeded from memory, not a map.
//
// These drive the map pins on the neighborhood and directory pages, and three
// of the seven added by seed-neighborhoods-bodrum.ts were wrong by 4–6 km.
// Checked against Nominatim — the same source app/api/admin/geocode/route.ts
// geocodes with — by comparing every one of Bodrum's fifteen rows. Eleven came
// back within 1.5 km and are left alone; Akyarlar's 2.1 km gap is measured
// against a *mahalle* administrative centroid rather than a settlement node,
// which is not evidence the pin is wrong, so it stays too.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/fix-neighborhood-coords-bodrum.ts
// DRY_RUN=1 prints the diff without writing.
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'

const FIXES: { name: string; from: [number, number]; to: [number, number]; source: string }[] = [
  {
    name: 'Torba', from: [37.0839, 27.4139], to: [37.0744, 27.4590],
    source: 'OSM place=village "Torba, Bodrum, Muğla" — stored point was 4.14km west',
  },
  {
    name: 'Güvercinlik', from: [37.1358, 27.5386], to: [37.1360, 27.5813],
    source: 'OSM place=village "Güvercinlik, Bodrum, Muğla" — latitude was right, longitude 3.79km off',
  },
  {
    // The honest one: OSM has no settlement node for Yalıçiftlik, only a bay
    // (36.9944,27.5163) and several stretches of Yalıçiftlik Caddesi clustered
    // at 37.01–37.02, 27.55–27.56. So the stored point is provably wrong —
    // roughly 6km too far north — without the right answer being provable.
    // This lands on land among those roads, near the head of the bay; pinning
    // the bay centroid itself would put the marker in water. Still worth a
    // human eye on a map.
    name: 'Yalıçiftlik', from: [37.0653, 27.5322], to: [37.0150, 27.5500],
    source: 'estimated from the Yalıçiftlik Caddesi cluster + bay head — NOT a settlement node',
  },
]

// Bodrum peninsula, generously drawn. A typo in the table above should fail
// here rather than drop a pin in the Aegean or in another province.
const BOUNDS = { latMin: 36.90, latMax: 37.25, lonMin: 27.15, lonMax: 27.65 }

async function main() {
  const bodrum = await prisma.city.findUnique({ where: { slug: 'bodrum' }, select: { id: true, name: true } })
  if (!bodrum) {
    console.error('✗ bodrum city row missing')
    process.exit(1)
  }

  for (const f of FIXES) {
    const [lat, lon] = f.to
    if (lat < BOUNDS.latMin || lat > BOUNDS.latMax || lon < BOUNDS.lonMin || lon > BOUNDS.lonMax) {
      console.error(`✗ ${f.name}: ${lat},${lon} is outside the Bodrum peninsula — refusing`)
      process.exit(1)
    }
  }

  console.log(`→ ${FIXES.length} coordinates to correct in ${bodrum.name}${DRY_RUN ? ' — DRY RUN, nothing will be written' : ''}`)

  let changed = 0, skipped = 0
  for (const f of FIXES) {
    const row = await prisma.neighborhood.findUnique({
      where:  { cityId_name: { cityId: bodrum.id, name: f.name } },
      select: { id: true, lat: true, lng: true },
    })
    if (!row) { console.log(`  ? ${f.name} — no such row, skipped`); skipped++; continue }

    const at = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.0001
    if (at(row.lat, f.to[0]) && at(row.lng, f.to[1])) {
      console.log(`  = ${f.name} (already corrected)`); skipped++; continue
    }
    // Only move a pin that still sits where this script expects. If someone has
    // since fixed it by hand — with a real map — that wins over these numbers.
    if (!at(row.lat, f.from[0]) || !at(row.lng, f.from[1])) {
      console.log(`  ! ${f.name} is at ${row.lat},${row.lng}, not the expected ${f.from[0]},${f.from[1]} — left alone`)
      skipped++
      continue
    }

    if (!DRY_RUN) {
      await prisma.neighborhood.update({ where: { id: row.id }, data: { lat: f.to[0], lng: f.to[1] } })
    }
    console.log(`  ~ ${f.name}: ${f.from[0]},${f.from[1]} → ${f.to[0]},${f.to[1]}`)
    console.log(`      ${f.source}`)
    changed++
  }

  console.log(`✓ ${DRY_RUN ? 'would update' : 'updated'} ${changed}, ${skipped} skipped`)
}

main().finally(() => prisma.$disconnect())
