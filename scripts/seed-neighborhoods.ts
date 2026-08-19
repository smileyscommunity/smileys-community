// Seed a city's neighborhood list from a JSON file.
//
// Neighborhoods are the one hard launch blocker: every picker in the product
// reads this table — profile, apply, board post, hangout, directory submit —
// and `safeNeighborhoodFor` silently nulls a name the city doesn't have, so a
// city with no rows looks like it saved your input and then lost it. The
// go-live gate now refuses `live` without them.
//
// Until now each city meant a new hand-written script (Istanbul's, Bodrum's),
// plus the fix-ups afterwards: Bodrum needed four separate passes to backfill
// vibe/area, repair coordinates and de-duplicate emoji. The judgment — which
// districts count, what they're like, how they group — is genuinely editorial
// and belongs to a person. The mechanical half is not: slugs, sortOrder,
// uniqueness, clamping, and not clobbering what an admin has since edited.
// That half is this script.
//
//   npx tsx --env-file=.env --env-file=.env.local \
//     scripts/seed-neighborhoods.ts <city-slug> <file.json>
//
//   DRY_RUN=1      print the plan, write nothing (do this first)
//   FILL_BLANKS=1  also fill vibe/area/lat/lng on EXISTING rows, but only
//                  where the column is currently null — never overwrites a
//                  value someone chose. This is the Bodrum fix-up pass,
//                  generalised; off by default because the safe default is
//                  "touch nothing that already exists".
//
// The file is an array of objects. `name` is the only required key:
//
//   [
//     { "name": "Kadıköy", "emoji": "🎨", "vibe": "Independent & lively",
//       "area": "Asian", "cost": 2, "lat": 40.9903, "lng": 29.0270 },
//     { "name": "Moda" }
//   ]
//
// `lon` is accepted as an alias for `lng` — the existing Bodrum list uses it,
// and having the generator reject that data would be a silly way to fail.
import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'
import { neighborhoodToSlug } from '@/lib/neighborhoods'

const DRY_RUN     = process.env.DRY_RUN === '1'
const FILL_BLANKS = process.env.FILL_BLANKS === '1'

export interface Entry {
  name: string
  emoji?: string
  vibe?: string
  area?: string
  cost?: number
  lat?: number
  lng?: number
  lon?: number
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function readEntries(path: string): Entry[] {
  let raw: string
  try { raw = readFileSync(path, 'utf8') } catch { fail(`can't read ${path}`) }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch (e) { fail(`${path} is not valid JSON — ${(e as Error).message}`) }
  if (!Array.isArray(parsed)) fail(`${path} must contain a JSON array of neighborhoods`)
  return parsed as Entry[]
}

/**
 * Everything that can be wrong with the file, reported at once.
 *
 * Collected rather than thrown one at a time: fixing a 40-row list one error
 * per run is how a person gives up and edits the database by hand.
 */
export function validateEntries(entries: Entry[], citySlug: string): string[] {
  const problems: string[] = []
  const bySlug = new Map<string, string>()
  const byName = new Map<string, number>()

  entries.forEach((e, i) => {
    const at = `row ${i + 1}`
    if (!e || typeof e !== 'object') { problems.push(`${at}: not an object`); return }
    if (typeof e.name !== 'string' || !e.name.trim()) { problems.push(`${at}: "name" is required`); return }

    const name = e.name.trim()
    const slug = neighborhoodToSlug(name)

    // A name that slugifies to nothing (emoji-only, punctuation) would collide
    // with every other such name on the (cityId, slug) unique index.
    if (!slug) problems.push(`${at}: "${name}" produces an empty slug`)
    // Same slug as the city itself reads as the city, not a neighborhood.
    if (slug && slug === citySlug) problems.push(`${at}: "${name}" slugifies to "${slug}", the city's own slug`)


    // Name and slug are both unique per city, so a clash inside the FILE would
    // fail mid-run and leave the list half-applied. Reported as ONE problem
    // per row, most specific first: the same name twice is a typo to delete,
    // while two different names sharing a slug is a decision (which spelling
    // wins). Saying both about one row just makes a long list harder to read.
    const nameKey = name.toLowerCase()
    if (byName.has(nameKey)) {
      problems.push(`${at}: "${name}" is listed twice`)
    } else {
      byName.set(nameKey, i)
      if (slug) {
        const prev = bySlug.get(slug)
        if (prev) problems.push(`${at}: "${name}" and "${prev}" both slugify to "${slug}"`)
        else bySlug.set(slug, name)
      }
    }

    if (e.cost != null && (!Number.isInteger(e.cost) || e.cost < 1 || e.cost > 3)) {
      problems.push(`${at}: cost must be 1, 2 or 3 (got ${e.cost})`)
    }
    const lat = e.lat, lng = e.lng ?? e.lon
    if (lat != null && (typeof lat !== 'number' || lat < -90 || lat > 90)) problems.push(`${at}: lat out of range (${lat})`)
    if (lng != null && (typeof lng !== 'number' || lng < -180 || lng > 180)) problems.push(`${at}: lng out of range (${lng})`)
    // One coordinate alone puts a pin in the sea off West Africa.
    if ((lat == null) !== (lng == null)) problems.push(`${at}: "${name}" has only one of lat/lng — give both or neither`)
  })

  return problems
}

async function main() {
  const [citySlug, filePath] = process.argv.slice(2)
  if (!citySlug || !filePath) {
    console.error('Usage: npx tsx --env-file=.env --env-file=.env.local scripts/seed-neighborhoods.ts <city-slug> <file.json>')
    process.exit(1)
  }

  const city = await prisma.city.findUnique({
    where:  { slug: citySlug },
    select: { id: true, name: true, slug: true, status: true },
  })
  if (!city) fail(`no city with slug "${citySlug}" — create it in /admin/cities first`)

  const entries = readEntries(filePath)
  if (entries.length === 0) fail(`${filePath} is an empty list`)

  const problems = validateEntries(entries, city.slug)
  if (problems.length) {
    console.error(`✗ ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${filePath}:`)
    problems.forEach(p => console.error(`    ${p}`))
    process.exit(1)
  }

  const existing = await prisma.neighborhood.findMany({
    where:  { cityId: city.id },
    select: { id: true, name: true, slug: true, vibe: true, area: true, lat: true, lng: true },
  })
  const bySlug = new Map(existing.map(n => [n.slug, n]))
  const byName = new Map(existing.map(n => [n.name.toLowerCase(), n]))

  // Continue the display order rather than restarting at 0 — the live rows
  // already hold low numbers and renumbering them would reshuffle the picker
  // under members who have learned where things are.
  const maxOrder = (await prisma.neighborhood.aggregate({
    where: { cityId: city.id },
    _max:  { sortOrder: true },
  }))._max.sortOrder ?? -1
  let nextOrder = maxOrder + 1

  console.log(`→ ${city.name} (${city.status}) — ${entries.length} in file, ${existing.length} already in the city`)
  if (DRY_RUN) console.log('  DRY RUN — nothing will be written')
  if (FILL_BLANKS) console.log('  FILL_BLANKS — null columns on existing rows will be filled')

  let created = 0, filled = 0, skipped = 0

  for (const e of entries) {
    const name  = e.name.trim()
    const slug  = neighborhoodToSlug(name)
    const lng   = e.lng ?? e.lon ?? null
    const lat   = e.lat ?? null
    const found = bySlug.get(slug) ?? byName.get(name.toLowerCase())

    if (found) {
      // Only ever fills a column that is currently null. Names, emoji, slugs
      // and coordinates on a live row are somebody's decision — an admin may
      // have corrected them after the first run, and a re-run must not undo
      // that. This is why the default is to touch nothing.
      const patch: Record<string, unknown> = {}
      if (FILL_BLANKS) {
        if (found.vibe == null && e.vibe) patch.vibe = e.vibe
        if (found.area == null && e.area) patch.area = e.area
        if (found.lat  == null && lat != null) patch.lat = lat
        if (found.lng  == null && lng != null) patch.lng = lng
      }
      // Say what was NOT applied, too. Filling only nulls is the safe rule,
      // but silence about the rest is how an operator edits a vibe in the
      // file, sees "3 already present", and believes it landed. Refusing to
      // overwrite is a decision; hiding the refusal is a bug.
      const refused = FILL_BLANKS
        ? (['vibe', 'area'] as const)
            .filter(k => e[k] && found[k] != null && e[k] !== found[k])
            .map(k => `${k} ("${found[k]}" kept, file says "${e[k]}")`)
        : []

      if (Object.keys(patch).length > 0) {
        if (!DRY_RUN) await prisma.neighborhood.update({ where: { id: found.id }, data: patch })
        console.log(`  ~ ${name} — ${DRY_RUN ? 'would fill' : 'filled'} ${Object.keys(patch).join(', ')}`)
        filled++
      } else {
        skipped++
      }
      if (refused.length) {
        console.log(`  ! ${name} — left as-is: ${refused.join('; ')}. Change it in /admin, not here.`)
      }
      continue
    }

    const sortOrder = nextOrder++
    if (!DRY_RUN) {
      await prisma.neighborhood.create({
        data: {
          cityId: city.id,
          name,
          slug,
          emoji: e.emoji ?? '📍',
          vibe:  e.vibe ?? null,
          area:  e.area ?? null,
          cost:  e.cost ?? 2,
          lat, lng,
          active: true,
          sortOrder,
        },
      })
    }
    console.log(`  + ${name} (${slug})${e.area ? ` [${e.area}]` : ''} cost ${e.cost ?? 2}${lat != null ? ` @ ${lat},${lng}` : ''} — sortOrder ${sortOrder}`)
    created++
  }

  // Rows the city has that the file doesn't mention. Reported, never touched:
  // deactivating them is a judgement call (a retired district vs a name simply
  // left out of this file), and doing it silently would empty pickers members
  // are already using.
  const fileSlugs = new Set(entries.map(e => neighborhoodToSlug(e.name.trim())))
  const unlisted  = existing.filter(n => !fileSlugs.has(n.slug))
  if (unlisted.length) {
    console.log(`  ℹ ${unlisted.length} existing row${unlisted.length === 1 ? '' : 's'} not in the file, left untouched: ${unlisted.map(n => n.name).join(', ')}`)
  }

  console.log(`✓ ${DRY_RUN ? 'would create' : 'created'} ${created}, ${FILL_BLANKS ? `${DRY_RUN ? 'would fill' : 'filled'} ${filled}, ` : ''}${skipped} already present`)
  if (!DRY_RUN && created > 0 && city.status !== 'live') {
    console.log(`  ${city.name} is ${city.status} — the go-live gate also needs at least one active club and one city host.`)
  }
}

// Only run as a CLI. validateEntries is exported and unit-tested, and an
// import must not fire the whole seeding run as a side effect.
if (/seed-neighborhoods\.ts$/.test(process.argv[1] ?? '')) {
  main().finally(() => prisma.$disconnect())
}
