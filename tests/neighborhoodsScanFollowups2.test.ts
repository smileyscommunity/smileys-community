import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Neighborhoods scan 2026-09-28, items 14–20: other cities' pages stop
// promising Istanbul's events; "Loved by locals" needs a visible positive
// review; "most active" means events; guests get the application, not
// members-only routes; every outbound link keeps the city; the wall says who
// may post before the composer opens; the small fixes.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const index    = read('app/neighborhoods/page.tsx')
const detail   = read('app/neighborhoods/[slug]/page.tsx')
const sections = read('app/neighborhoods/[slug]/NeighborhoodSections.tsx')
const wall     = read('components/NeighborhoodWall.tsx')
const grid     = read('components/NeighborhoodGrid.tsx')
const picks    = read('components/LocalFavorites.tsx')
const sitemap  = read('app/sitemap.ts')

describe('a page without a guide describes itself, not events it lacks (item 14)', () => {
  it('title, description, OG cta and subtitle are neutral without a guide', () => {
    expect(detail).toContain(": `${meta.emoji} ${name} — ${city.name} Neighborhoods · Smileys Community`")
    expect(detail).not.toContain('Social Events in ${city.name}')
    expect(detail).not.toContain('Discover upcoming social events')
    expect(detail).toContain("cta:     guide?.tagline ? 'See events here' : \"See who's around\"")
    expect(detail).toContain("{guide ? 'A neighborhood guide for the Smileys community' : `A Smileys community neighborhood in ${city.name}`}")
  })
  it('another city\'s area reads as a part of the city', () => {
    expect(detail).toContain('`in the ${area} part of ${cityName}`')
  })
  it('the closing CTA is for guests and asks about people, not events', () => {
    expect(detail).toContain('{!session && (\n        <section className="border-t border-gray-100 bg-gray-900">')
    expect(detail).toContain('Want to meet people in {name}?')
    expect(detail).not.toContain('Want to join these events?')
  })
  it('the sitemap ranks guide-less pages lower', () => {
    expect(sitemap).toContain("!!citySlug && fileMtime('neighborhoods', citySlug, `${n.slug}.json`) !== undefined) ? 0.7 : 0.5")
  })
})

describe('"Loved by locals" is a visible, positive recommendation (item 15)', () => {
  it('needs a visible review, quotes a 4+ one, counts only visible ones', () => {
    expect(index).toContain('reviews: { some: { isHidden: false } } }')
    expect(index).toContain('where:  { comment: { not: null }, isHidden: false, rating: { gte: 4 } }')
    expect(index).toContain('_count: { select: { reviews: { where: { isHidden: false } } } }')
  })
})

describe('"most active" is about events (item 16)', () => {
  it('the focus neighbourhood is picked by activity and the heading is honest with none', () => {
    expect(index).toContain('.sort((a, b) => b.activityScore - a.activityScore || b.memberCount - a.memberCount)[0]?.name ?? null')
    expect(index).not.toContain('.sort((a, b) => b._count._all - a._count._all)[0]?.neighborhood')
    expect(index).toContain('`Where the most Smileys members in ${city.name} live right now.`')
    expect(grid).toContain("shortlist.some(n => n.eventCount > 0) ? 'Most active right now' : 'Where members live'")
  })
})

describe('guests are sent to the application, not members-only routes (item 17)', () => {
  it('index "Create a meetup" is for members; guests get /apply with the city', () => {
    expect(index).toContain('{session ? (\n                  <Link href={`/hangouts?new=1')
    expect(index).toContain('<Link href={`/apply${cityQuery}`}\n                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-700')
  })
  it('the two /members links on the detail page render only for members', () => {
    const links = sections.split('<Link href={`/members?neighborhood=${encodeURIComponent(name)}`}').length - 1
    expect(links).toBe(2)
    expect(sections.split('{myId && (\n').length - 1).toBeGreaterThanOrEqual(3)
  })
})

describe('every outbound link keeps the city (item 18)', () => {
  it('detail page: back link, breadcrumb, share url, closing CTA', () => {
    expect(detail).toContain('<Link href={`/neighborhoods${cityQuery}`} className="inline-flex items-center gap-1.5 text-sm text-white/70')
    expect(detail).toContain("name: 'Neighborhoods', item: `${APP_URL}/neighborhoods${cityQuery}` }")
    expect(detail).toContain('url={pageUrl}')
    expect(detail).toContain('<Link href={`/apply${cityQuery}`} className="px-6 py-3 rounded-xl bg-amber-700')
    expect(detail).not.toContain('href="/neighborhoods"')
    expect(detail).not.toContain('href="/apply"')
  })
  it('sections: clubs, events, visiting, board', () => {
    expect(sections).toContain('<Link href={`/clubs${cityQuery}`}')
    expect(sections).toContain('href={`/events?neighborhood=${encodeURIComponent(name)}&city=${encodeURIComponent(city.slug)}`}')
    expect(sections).toContain('href={`/visiting${cityQuery}`}')
    expect(sections).toContain('href={`/board?l=${l.id}&city=${encodeURIComponent(city.slug)}`}')
    expect(sections).not.toContain('href="/clubs"')
    expect(sections).not.toContain('href="/visiting"')
  })
  it('the index hands LocalFavorites the city directory link', () => {
    expect(index).toContain('<LocalFavorites picks={serialisedPicks} directoryHref={`/directory${cityQuery}`} />')
    expect(picks).toContain('<Link href={directoryHref}')
    expect(picks).not.toContain('href="/directory"')
  })
})

describe('the wall says who may post before the composer opens (item 19)', () => {
  it('the page computes canPost with the POST rule and the wall shows a note instead', () => {
    expect(sections).toContain('const canPost = viewer ? (await resolvePostingCityId(viewer)) === cityId : false')
    expect(sections).toContain('canPost={canPost} cityName={city.name}')
    expect(sections).toContain('Members of {city.name}')
    expect(sections).not.toContain('Open to all members')
    expect(wall).toContain('{!canPost ? (')
    expect(wall).toContain("posting is for members of {cityName ?? 'this city'}")
  })
})

describe('the small fixes (item 20)', () => {
  it('places tolerate a missing items array and key by position', () => {
    expect(sections).toContain('{(cat.items ?? []).map((place, pi) => (')
    expect(sections).toContain('<div key={`${pi}-${place.name}`}')
  })
  it('the vibe keeps its casing', () => {
    expect(detail).not.toContain('vibe.toLowerCase()')
    expect(detail).toContain("const vibeLine = vibe ? `${name}: ${vibe}${/[.!?]$/.test(vibe) ? '' : '.'} ` : ''")
  })
  it('"set your neighbourhood" only on the reader\'s own city', () => {
    expect(detail).toContain('const hasNoNeighborhood  = !!session && !session.neighborhood && session.cityId === cityId')
  })
  it('member strips count activated members, the same set totalLocals counts', () => {
    expect(index).toContain("neighborhood: userNeighborhood, cityId, ...ACTIVATED_MEMBER_WHERE,")
    expect(index).not.toContain("cityId, status: 'approved',")
    expect(sections).toContain("neighborhood: name, cityId, ...ACTIVATED_MEMBER_WHERE,")
  })
  it('Istanbul\'s photo map serves only Istanbul', () => {
    expect(detail).toContain("guide?.image ?? (city.slug === DEFAULT_CITY_SLUG ? neighborhoodImage(name) : null)")
    expect(grid.split('cityQuery ? null : neighborhoodImage(n.name)').length - 1).toBe(2)
  })
})
