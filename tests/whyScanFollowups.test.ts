import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Why scan 2026-09-29, items 1–10.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page  = read('app/why/page.tsx')
const cache = read('lib/cityPageCache.ts')
const code  = page.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('1: member quotes go through the public gate, and edits clear the cache', () => {
  it('author gate, connections-only photo rule, the city\'s own quotes first', () => {
    expect(page).toContain("where:   { active: true, AND: [{ OR: [{ cityId }, { cityId: null }] }, testimonialAuthorOk()] },")
    expect(page).toContain('select:  { ...TESTIMONIAL_SELECT, category: true },')
    expect(page).toContain('.then(rows => rows.map(publicTestimonial).sort(')
  })
  it('the why tag is cleared with the city pages, including photo edits and account deletion', () => {
    expect(cache).toContain("export const WHY_PAGE_TAG = 'why-page'")
    expect(cache).toContain('try { revalidateTag(CITY_PAGE_TAG); revalidateTag(WHY_PAGE_TAG) } catch {')
    expect(page).toContain('{ revalidate: 300, tags: [WHY_PAGE_TAG] },')
    expect(read('app/api/admin/story-photos/route.ts')).toContain('bustCityPages()\n  return NextResponse.json(item)')
    expect(read('app/api/admin/story-photos/[id]/route.ts').split('bustCityPages()').length - 1).toBe(2)
    expect(read('lib/anonymizeUser.ts')).toContain('bustCityPages()')
  })
})

describe('2: no invented members', () => {
  it('no fallback quotes; the section hides when there are none; no "no scripts" claim', () => {
    expect(page).not.toContain('MOCK_TESTIMONIALS')
    expect(page).not.toContain('Sophie M.')
    expect(page).toContain('{testimonials.length > 0 && (')
    expect(page).not.toContain('No scripts. No incentives')
  })
})

describe('3: the page is about the reader\'s city', () => {
  it('resolves ?city= and keeps it on every link', () => {
    expect(page).toContain('const { city, cityId } = await resolveCityForPage(searchParams)')
    expect(page).toContain('await getWhyPageData(cityId, city.timezone)')
    expect(page.split('href={`/apply${qs}`}').length - 1).toBe(2)
    expect(page.split('href={`/events${qs}`}').length - 1).toBe(3)
    expect(page).toContain('href={`/${city.slug}/clubs`}')
    expect(page).toContain("prisma.club.findMany({ where: { isActive: true, cityId },")
  })
  it('the admin hero copy is the default city\'s; others get a neutral hero with their name', () => {
    expect(page).toContain('const own = city.slug === DEFAULT_CITY_SLUG ? (c.why ?? {}) : {}')
    expect(page).toContain('`A curated real-life social community for globally minded people in ${city.name}.`')
    expect(code).not.toMatch(/Istanbul/)
  })
  it('the apply form sends the applicant to their own city\'s page', () => {
    expect(read('app/apply/ApplyClient.tsx')).toContain('href={`/why?city=${targetCitySlug}`}')
  })
  it('a founding city\'s clubs show no "0 members"', () => {
    expect(page).toContain('{c.memberCount > 0 && (')
  })
})

describe('4: the week is the real calendar', () => {
  it('next seven days of published events, banned hosts out, hidden when empty', () => {
    expect(page).not.toMatch(/const WEEK\b/)
    expect(page).not.toContain('c.week')
    expect(page).toContain("cityId, status: 'published',")
    expect(page).toContain('{ date: { gt: today, lte: shiftDay(today, 6) } },')
    expect(page).toContain('if (hidden.has(e.hostId)) continue')
    expect(page).toContain('{weekEvents > 0 && (')
    expect(page).not.toContain('Something every week, year-round')
  })
  it('the admin Week tab says it is no longer shown', () => {
    expect(read('app/admin/content/page.tsx')).toContain('Not shown on the site any more')
  })
})

describe('5: measured numbers only', () => {
  it('no editorial stat rows (WhatsApp reach, 1,000+ events)', () => {
    expect(page).not.toContain('resolveStats')
    expect(page).toContain("{ value: approx(s.members), label: 'Members across Smileys' },")
    expect(page).toContain("prisma.city.count({ where: { status: 'live' } })")
  })
})

describe('6–8: readable, sturdy, accessible', () => {
  it('dark text on the amber bands; buttons untouched', () => {
    expect(page).toContain('text-center text-amber-950">')
    expect(page).not.toMatch(/text-amber-(100|200)\b/)
    expect(page).toContain('className="btn-white">')
    expect(page).toContain('className="btn-outline-white">Browse events first</Link>')
    expect(page).toContain('className="btn-primary text-base px-8 py-4">')
  })
  it('every hero field is trimmed with a fallback', () => {
    for (const k of ['headline', 'tagline', 'subtitle', 'closing']) expect(page).toMatch(new RegExp(`${k}:\\s+own\\.${k}\\?\\.trim\\(\\)\\s+\\|\\|`))
    expect(page).not.toMatch(/why\.(tagline|closing) \?\?/)
  })
  it('decoration is hidden; quotes are figures; the who-list is a list', () => {
    expect(page).toContain('<span aria-hidden="true">😊</span> Smileys {city.name}')
    expect(page.split('<svg aria-hidden="true"').length - 1).toBe(2)
    expect(page).toContain('<blockquote className="text-sm text-gray-700 leading-relaxed mb-4">{t.quote}</blockquote>')
    expect(page).toContain('<p aria-hidden="true" className="text-amber-500 text-3xl leading-none mb-3 font-serif">&ldquo;</p>')
    expect(page).toContain('<ul className="flex flex-wrap justify-center gap-3">')
    expect(page).not.toContain('hover:bg-amber-50 hover:text-amber-700')
  })
})

describe('9–10: honest claims, small links', () => {
  it('no absolute promises; no oversold member price', () => {
    expect(page).not.toContain('No drama, no spam, no bad actors')
    expect(page).not.toContain('No anonymous accounts')
    expect(page).not.toContain('discounted member price')
    expect(page).toContain('Everyone applies with their real name and a photo')
  })
  it('sitemap date from content.json; club links keep the city', () => {
    expect(read('app/sitemap.ts')).toContain("{ url: `${BASE}/why`,           priority: 0.7, changeFrequency: 'monthly', lastModified: fileMtime('content.json') },")
    expect(page).toContain('<ClubLink key={c.id} slug={c.slug} citySlug={city.slug}')
  })
})
