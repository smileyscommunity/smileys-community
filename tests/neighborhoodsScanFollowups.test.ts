import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { distanceKm, nearestByDistance, NEIGHBORHOOD_META } from '@/lib/neighborhoods'

// Neighborhoods scan 2026-09-28, items 7–13: the picker buttons point where
// the picker is; "close to X and Y" is distance, not sort order; the index
// counts on the city's day; links use the registry slug; the banner reads
// the shape the admin writes; global clubs stay in "Clubs active"; "going" is
// the attendee count.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const index    = read('app/neighborhoods/page.tsx')
const detail   = read('app/neighborhoods/[slug]/page.tsx')
const sections = read('app/neighborhoods/[slug]/NeighborhoodSections.tsx')

describe('the two "set your neighborhood" buttons go to the page with the picker (item 7)', () => {
  it('index CTAs never send a member to /settings', () => {
    expect(index).not.toContain("'/settings'")
    // 2026-09-28 item 18: the guest path carries the city.
    expect(index).toContain("session ? '/profile' : `/apply${cityQuery}`")
    expect(index).toContain("userNeighborhood ? '#your-neighborhood' : session ? '/profile' : `/apply${cityQuery}`")
  })
})

describe('nearest neighborhoods by distance (item 8)', () => {
  const meta = (name: string) => ({ name, lat: NEIGHBORHOOD_META[name].lat, lon: NEIGHBORHOOD_META[name].lon })
  const istanbul = Object.keys(NEIGHBORHOOD_META).map(meta)
  it('Florya is close to Yeşilköy and Ataköy, not Beykoz across the Bosphorus', () => {
    const florya = nearestByDistance(meta('Florya'), istanbul, 2).map(n => n.name)
    expect(florya[0]).toBe('Yeşilköy')
    expect(florya).not.toContain('Beykoz')
    expect(florya).not.toContain('Sarıyer')
    expect(nearestByDistance(meta('Pendik'), istanbul, 2).map(n => n.name)).not.toContain('Kağıthane')
    expect(distanceKm(meta('Florya'), meta('Beykoz'))).toBeGreaterThan(25)
    expect(distanceKm(meta('Florya'), meta('Yeşilköy'))).toBeLessThan(5)
  })
  it('a neighborhood without coordinates ranks nothing and never appears', () => {
    const rows = [meta('Moda'), { name: 'Nowhere', lat: null, lon: null }, meta('Kadıköy')]
    expect(nearestByDistance(meta('Kadıköy'), rows, 3).map(n => n.name)).toEqual(['Moda'])
    expect(nearestByDistance({ name: 'X', lat: null, lon: null }, rows, 3)).toEqual([])
  })
  it('the page uses it, keeping the same-area order only as the fallback', () => {
    expect(detail).toContain('const byDistance = nearestByDistance(meta, siblings, take)')
    expect(detail).toContain('if (byDistance.length > 0) return byDistance.map(n => ({ name: n.name, slug: n.slug }))')
  })
})

describe('the index counts on the city day and links by registry slug (items 9–10)', () => {
  it('today comes from the city timezone, after the city resolves', () => {
    expect(index).toContain('const today = todayInTz(city.timezone)')
    expect(index).not.toContain("toISOString().split('T')[0]")
    expect(index.indexOf('const today = todayInTz(city.timezone)')).toBeGreaterThan(index.indexOf('await resolveCityForPage(searchParams)'))
  })
  it('no link re-derives a slug from a name', () => {
    expect(index).not.toContain('neighborhoodToSlug(')
    expect(index).toContain('href={`/neighborhoods/${viewByName.get(userNeighborhood)!.slug}${cityQuery}`}')
    expect(index).toContain('const focusSlug = focusNeighborhood ? viewByName.get(focusNeighborhood)?.slug ?? null : null')
    expect(index).toContain('{focusSlug && (')
  })
})

describe('banner, clubs and going (items 11–13)', () => {
  it('the banner reader accepts the array the admin saves and filters by city', () => {
    expect(index).toContain("const list: NbBanner[] = Array.isArray(data) ? data : data?.active && data?.headline ? [data] : []")
    expect(index).toContain("(typeof b.city === 'string' && b.city) ? b.city : DEFAULT_CITY_SLUG) === city.slug")
  })
  it('"Clubs active around X" keeps global clubs', () => {
    expect(sections).toContain("where:  { id: { in: clubActivity.map(c => c.clubId as string) }, isActive: true },")
    expect(sections).not.toContain("isActive: true, cityId },")
  })
  it('"going" is the attendee count the query already fetched', () => {
    expect(sections).toContain('const goingCount = event._count.attendees')
    expect(sections).not.toContain('const goingCount = event.totalSpots - spotsLeft')
  })
})
