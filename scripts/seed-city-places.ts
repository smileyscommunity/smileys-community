// Seed a city's directory from Google Places.
//
// The directory is the one surface that makes a checkable factual promise —
// this place exists, at this address, and is open. So every fact here comes
// from Places and nothing is invented: name, address, coordinates, phone,
// website and hours are mirrored, `placeId` is stored as the durable key for
// later re-verification, and `verifiedAt` is stamped at fetch time.
//
// What this script does NOT do is write the judgment. `description` lands as
// a plainly-marked factual placeholder and every row lands UNAPPROVED, in the
// same /admin/directory queue member submissions go through. Someone decides
// whether a venue belongs in a curated directory; a search ranking doesn't.
//
// Usage (dry run prints what it would create and writes nothing):
//   GOOGLE_PLACES_API_KEY=... npx tsx --env-file=.env --env-file=.env.local \
//     scripts/seed-city-places.ts
//   CITY=bodrum APPLY=1 ... same command          # actually write
//
// Env knobs: CITY (default bodrum), APPLY (unset = dry run), PER_HOOD,
// MIN_RATING, MIN_REVIEWS, ONLY_HOOD (one neighbourhood slug, for a trial run).

import { prisma } from '@/lib/prisma'
import { BUSINESS_CATEGORY_SET, DIRECTORY_LIMITS } from '@/lib/directory-constants'

const API_KEY     = process.env.GOOGLE_PLACES_API_KEY
const CITY_SLUG   = process.env.CITY ?? 'bodrum'
const APPLY       = process.env.APPLY === '1'
const PER_HOOD    = Number(process.env.PER_HOOD ?? 4)
const MIN_RATING  = Number(process.env.MIN_RATING ?? 4.2)
const MIN_REVIEWS = Number(process.env.MIN_REVIEWS ?? 40)
const ONLY_HOOD   = process.env.ONLY_HOOD ?? null
// Places bills per request. A 15-neighbourhood city × 4 intents is 60 calls
// per run, so the radius is wide enough that one call per intent suffices.
const RADIUS_M    = 1800

// What we search for, and which of OUR categories the result becomes. The
// directory's vocabulary (lib/directory-constants) is the only one used —
// club categories describe recurring groups of people, not venues, and
// introducing a second venue taxonomy is how you end up reconciling two.
const INTENTS: { query: string; category: string }[] = [
  { query: 'restaurant',   category: 'Restaurant' },
  { query: 'cafe',         category: 'Cafe'       },
  { query: 'bar',          category: 'Bar'        },
  { query: 'gym or yoga studio', category: 'Fitness' },
]

// Places' own type vocabulary → ours, when it disagrees with the intent that
// found it (a "restaurant" search legitimately surfaces cafes and bars).
const TYPE_MAP: Record<string, string> = {
  restaurant: 'Restaurant', meal_takeaway: 'Restaurant', meal_delivery: 'Restaurant',
  cafe: 'Cafe', coffee_shop: 'Cafe', bakery: 'Cafe',
  bar: 'Bar', night_club: 'Bar', pub: 'Bar',
  gym: 'Fitness', fitness_center: 'Fitness', yoga_studio: 'Fitness', spa: 'Beauty',
  beauty_salon: 'Beauty', hair_salon: 'Beauty',
  store: 'Shop', clothing_store: 'Shop', book_store: 'Shop', supermarket: 'Shop',
}

interface PlaceResult {
  id: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  rating?: number
  userRatingCount?: number
  businessStatus?: string
  primaryType?: string
  types?: string[]
  nationalPhoneNumber?: string
  websiteUri?: string
  regularOpeningHours?: { weekdayDescriptions?: string[] }
}

// Places API (New). The field mask is explicit and minimal: you are billed by
// what you ask for, and every field here maps to a column we actually store.
const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.rating', 'places.userRatingCount', 'places.businessStatus',
  'places.primaryType', 'places.types', 'places.nationalPhoneNumber',
  'places.websiteUri', 'places.regularOpeningHours.weekdayDescriptions',
].join(',')

async function searchPlaces(query: string, lat: number, lng: number): Promise<PlaceResult[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY!,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 20,
      languageCode: 'en',
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: RADIUS_M } },
    }),
  })
  if (!res.ok) {
    // Surface the API's own message — a bad key, a disabled API and an
    // over-quota project all fail here and are told apart by the body.
    const detail = await res.text().catch(() => '')
    throw new Error(`Places search failed (HTTP ${res.status}) for "${query}": ${detail.slice(0, 300)}`)
  }
  const data = await res.json() as { places?: PlaceResult[] }
  return data.places ?? []
}

function categoryFor(p: PlaceResult, intentCategory: string): string {
  for (const t of [p.primaryType, ...(p.types ?? [])]) {
    if (t && TYPE_MAP[t]) return TYPE_MAP[t]
  }
  return BUSINESS_CATEGORY_SET.has(intentCategory) ? intentCategory : 'Other'
}

// Deliberately factual and deliberately dull: this is a placeholder for the
// reviewer to replace, not a recommendation. It states only what Places told
// us, so nothing unverified ever reaches a member — the row is unapproved and
// invisible until someone writes the real line.
function placeholderDescription(p: PlaceResult, category: string, hood: string): string {
  const bits = [`${category} in ${hood}.`]
  if (p.rating && p.userRatingCount) {
    bits.push(`Rated ${p.rating.toFixed(1)} across ${p.userRatingCount.toLocaleString('en-US')} Google reviews.`)
  }
  bits.push('Awaiting an editorial description before approval.')
  return bits.join(' ').slice(0, DIRECTORY_LIMITS.description)
}

function clip(s: string | undefined | null, max: number): string | null {
  if (!s) return null
  const t = s.trim()
  return t ? t.slice(0, max) : null
}

async function main() {
  if (!API_KEY) {
    console.error('✗ GOOGLE_PLACES_API_KEY is not set.')
    console.error('  Create a key in a billing-enabled Google Cloud project with the')
    console.error('  "Places API (New)" enabled, then re-run with it in the environment.')
    process.exit(1)
  }

  const city = await prisma.city.findUnique({
    where:  { slug: CITY_SLUG },
    select: { id: true, name: true },
  })
  if (!city) throw new Error(`No city with slug "${CITY_SLUG}"`)

  const hoods = await prisma.neighborhood.findMany({
    where:   { cityId: city.id, active: true, ...(ONLY_HOOD ? { slug: ONLY_HOOD } : {}) },
    orderBy: { sortOrder: 'asc' },
    select:  { name: true, lat: true, lng: true },
  })
  const located = hoods.filter(h => h.lat != null && h.lng != null)
  if (!located.length) throw new Error(`No active neighbourhoods with coordinates in ${city.name}`)

  console.log(`${APPLY ? 'SEEDING' : 'DRY RUN'} — ${city.name}: ${located.length} neighbourhood(s), ` +
              `${INTENTS.length} intents, keeping ≤${PER_HOOD}/neighbourhood ` +
              `(rating ≥${MIN_RATING}, ≥${MIN_REVIEWS} reviews)`)
  if (hoods.length !== located.length) {
    console.log(`  ⚠ skipping ${hoods.length - located.length} neighbourhood(s) without coordinates`)
  }

  // Every place id already in the directory, city-wide: a re-run must never
  // duplicate a venue, and a venue a member already submitted wins.
  const existing = new Set(
    (await prisma.business.findMany({
      where: { placeId: { not: null } },
      select: { placeId: true },
    })).map(b => b.placeId!),
  )

  let created = 0, skippedExisting = 0, skippedQuality = 0, skippedClosed = 0
  const seenThisRun = new Set<string>()

  for (const hood of located) {
    const candidates: { p: PlaceResult; category: string }[] = []

    for (const intent of INTENTS) {
      let results: PlaceResult[]
      try {
        results = await searchPlaces(`${intent.query} in ${hood.name}, ${city.name}`, hood.lat!, hood.lng!)
      } catch (e) {
        // One failed intent must not abandon the whole city.
        console.error(`  ! ${hood.name}/${intent.query}: ${(e as Error).message}`)
        continue
      }
      for (const p of results) {
        if (!p.id || !p.displayName?.text) continue
        if (existing.has(p.id) || seenThisRun.has(p.id)) { skippedExisting++; continue }
        if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') { skippedClosed++; continue }
        if ((p.rating ?? 0) < MIN_RATING || (p.userRatingCount ?? 0) < MIN_REVIEWS) { skippedQuality++; continue }
        seenThisRun.add(p.id)
        candidates.push({ p, category: categoryFor(p, intent.category) })
      }
      // Gentle on the quota; this is a background seed, not a request path.
      await new Promise(r => setTimeout(r, 250))
    }

    // Quality over quantity is the platform's rule, so take the best few per
    // neighbourhood rather than everything that cleared the floor.
    candidates.sort((a, b) =>
      (b.p.rating ?? 0) - (a.p.rating ?? 0) ||
      (b.p.userRatingCount ?? 0) - (a.p.userRatingCount ?? 0))
    const keep = candidates.slice(0, PER_HOOD)

    console.log(`\n${hood.name} — ${keep.length} kept of ${candidates.length} candidates`)
    for (const { p, category } of keep) {
      const name = clip(p.displayName?.text, DIRECTORY_LIMITS.name)!
      console.log(`  ${category.padEnd(10)} ${name}  ${p.rating ?? '–'}★ (${p.userRatingCount ?? 0})`)
      if (!APPLY) continue

      await prisma.business.create({
        data: {
          name,
          category,
          description:  placeholderDescription(p, category, hood.name),
          neighborhood: clip(hood.name, DIRECTORY_LIMITS.neighborhood),
          address:      clip(p.formattedAddress, DIRECTORY_LIMITS.address),
          phone:        clip(p.nationalPhoneNumber, DIRECTORY_LIMITS.phone),
          website:      clip(p.websiteUri, DIRECTORY_LIMITS.website),
          latitude:     p.location?.latitude  ?? null,
          longitude:    p.location?.longitude ?? null,
          hours:        p.regularOpeningHours?.weekdayDescriptions ?? undefined,
          cityId:       city.id,
          placeId:      p.id,
          source:       'places',
          verifiedAt:   new Date(),
          // The whole point: seeded rows are invisible until a human approves
          // them, exactly like a member submission.
          isApproved:   false,
          isActive:     true,
        },
      })
      created++
    }
  }

  console.log(`\n${APPLY ? `✓ Created ${created} unapproved rows` : '✓ Dry run — nothing written'}`)
  console.log(`  skipped: ${skippedExisting} already known, ${skippedQuality} below quality floor, ${skippedClosed} not operational`)
  if (APPLY) console.log(`  Review and approve at ${process.env.APP_URL ?? ''}/admin/directory`)
  else       console.log('  Re-run with APPLY=1 to write.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
