import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  studentGuides, orderStudentAudiences, pickFirstEvents, pickRegularEvents,
  eventFilterLinks, eventsHref, buildFirstWeek, LANGUAGE_EXCHANGE_TAG,
  STUDENT_FIRST_EVENT_LIMIT, type StudentEventLike,
} from '@/lib/students'
import { DISCOVER_LINKS } from '@/lib/navLinks'

// The student hub may only point at content the city actually has, and may
// not invent anything about students. These pin the rules in lib/students
// and the few source-level promises the page makes.

const art = (slug: string, title: string, category: string, cityId: string | null = null) =>
  ({ slug, title, category, cityId })

const ev = (over: Partial<StudentEventLike> & { id: string }): StudentEventLike => ({
  date: '2026-10-01', price: 0, vibes: [], seriesId: null, isRecurring: false,
  isFirstTimerFriendly: false, status: 'published', ...over,
})

describe('studentGuides', () => {
  const articles = [
    art('entering-turkiye', 'Entering Türkiye: Visa-Free Stays, e-Visas and the 90/180 Rule', 'Residence & Legal'),
    art('working-remotely', 'Working Remotely from Türkiye: Digital Nomad Visa, Work Permissions', 'Residence & Legal'),
    art('residence-permit-first-application', 'Your First Residence Permit Application', 'Bureaucracy'),
    art('arriving-in-istanbul', 'Arriving in Istanbul: Getting from IST and Sabiha Gökçen into the City', 'Getting Around'),
    art('istanbulkart-mastery', 'İstanbulkart Mastery', 'Getting Around'),
    art('sim-card', 'Getting a SIM Card and Home Internet in Türkiye', 'Mobile & Digital'),
    art('emergency-numbers', 'Emergency Numbers in Türkiye: Call 112', 'Safety & Emergencies'),
    art('scams', 'Scams & Tourist Traps in Türkiye', 'Safety & Emergencies'),
  ]

  it('finds each question the city can answer, and leaves out the rest', () => {
    const keys = studentGuides(articles, 'c1').map(g => g.key)
    expect(keys).toEqual(['entry', 'residence', 'connect', 'transport', 'airport', 'safety', 'emergency'])
  })

  it('never offers the remote-work guide as the residence-permit guide ("Work Permissions")', () => {
    const g = studentGuides(articles, 'c1').find(x => x.key === 'residence')
    expect(g?.article.slug).toBe('residence-permit-first-application')
    const onlyRemote = studentGuides([articles[1]], 'c1')
    expect(onlyRemote.find(x => x.key === 'residence')).toBeUndefined()
  })

  it('keeps the airport guide and the transport-card guide apart', () => {
    const gs = studentGuides(articles, 'c1')
    expect(gs.find(x => x.key === 'airport')?.article.slug).toBe('arriving-in-istanbul')
    expect(gs.find(x => x.key === 'transport')?.article.slug).toBe('istanbulkart-mastery')
  })

  it('never uses one article for two questions', () => {
    const gs = studentGuides([art('safety-and-112', 'Staying safe and emergency numbers (112)', 'Safety & Emergencies')], 'c1')
    expect(gs).toHaveLength(1)
  })

  it("prefers the city's own article over a national one", () => {
    const gs = studentGuides([
      art('national-sim', 'SIM cards in Türkiye', 'Mobile & Digital', null),
      art('local-sim', 'SIM cards in İzmir', 'Mobile & Digital', 'izmir'),
    ], 'izmir')
    expect(gs[0].article.slug).toBe('local-sim')
  })
})

describe('orderStudentAudiences', () => {
  it('drops audiences with no experiences and puts nightlife last', () => {
    const out = orderStudentAudiences([
      { value: 'nightlife', count: 9 }, { value: 'budget', count: 4 },
      { value: 'first-time', count: 5 }, { value: 'foodie', count: 0 },
    ])
    expect(out.map(a => a.value)).toEqual(['first-time', 'budget', 'nightlife'])
  })
})

describe('pickFirstEvents', () => {
  it('takes first-timer-friendly events only, each weekly session once, skipping cancelled', () => {
    const out = pickFirstEvents([
      ev({ id: 'a', isFirstTimerFriendly: true, seriesId: 's1' }),
      ev({ id: 'b', isFirstTimerFriendly: true, seriesId: 's1' }),
      ev({ id: 'c', isFirstTimerFriendly: false }),
      ev({ id: 'd', isFirstTimerFriendly: true, status: 'cancelled' }),
      ev({ id: 'e', isFirstTimerFriendly: true }),
    ])
    expect(out.map(e => e.id)).toEqual(['a', 'e'])
  })

  it('caps the row', () => {
    const many = Array.from({ length: 10 }, (_, i) => ev({ id: `x${i}`, isFirstTimerFriendly: true }))
    expect(pickFirstEvents(many)).toHaveLength(STUDENT_FIRST_EVENT_LIMIT)
  })
})

describe('pickRegularEvents', () => {
  it('shows recurring activities once each, and at most one nightlife', () => {
    const out = pickRegularEvents([
      ev({ id: 'bar1', seriesId: 'n1', vibes: ['Nightlife'] }),
      ev({ id: 'bar2', seriesId: 'n2', vibes: ['Nightlife'] }),
      ev({ id: 'walk', seriesId: 'w1', vibes: ['Outdoor'] }),
      ev({ id: 'walk-next', seriesId: 'w1', vibes: ['Outdoor'] }),
      ev({ id: 'oneoff', vibes: ['Social'] }),
      ev({ id: 'lang', isRecurring: true, vibes: [LANGUAGE_EXCHANGE_TAG] }),
    ])
    expect(out.map(e => e.id)).toEqual(['bar1', 'walk', 'lang'])
  })

  it('does not repeat what the first-event row already shows', () => {
    const out = pickRegularEvents([ev({ id: 'a', seriesId: 's' }), ev({ id: 'b', seriesId: 't' })], new Set(['a']))
    expect(out.map(e => e.id)).toEqual(['b'])
  })
})

describe('eventFilterLinks', () => {
  it('offers only filters something matches, with counts', () => {
    const links = eventFilterLinks([
      ev({ id: '1', price: 0, isFirstTimerFriendly: true }),
      ev({ id: '2', price: 500 }),
      ev({ id: '3', price: 0, status: 'cancelled', vibes: [LANGUAGE_EXCHANGE_TAG] }),
    ], 'istanbul')
    expect(links.map(l => [l.key, l.count])).toEqual([['first', 1], ['free', 1]])
  })

  it('links to the calendar filters that exist, pinning a non-default city', () => {
    expect(eventsHref('istanbul', 'first=1')).toBe('/events?first=1')
    expect(eventsHref('izmir', 'free=1')).toBe('/events?free=1&city=izmir')
    expect(eventsHref('izmir')).toBe('/events?city=izmir')
    expect(eventsHref('istanbul')).toBe('/events')
    const [lang] = eventFilterLinks([ev({ id: 'l', price: 100, vibes: [LANGUAGE_EXCHANGE_TAG] })], 'istanbul')
    expect(new URLSearchParams(lang.href.split('?')[1]).get('tags')).toBe(LANGUAGE_EXCHANGE_TAG)
  })
})

describe('buildFirstWeek', () => {
  const base = {
    citySlug: 'bursa', cityName: 'Bursa', guides: [], audiences: [],
    hasFirstEvents: false, hasRegular: false, hasNeighborhoods: false, hasClubs: false,
  }

  it('always has the five steps, and never links to something the city lacks', () => {
    const steps = buildFirstWeek(base)
    expect(steps.map(s => s.key)).toEqual(['connect', 'city', 'explore', 'meet', 'rhythm'])
    const hrefs = steps.flatMap(s => s.links.map(l => l.href))
    expect(hrefs.some(h => h.startsWith('/handbook/'))).toBe(false)
    expect(hrefs).not.toContain('#first-event')
    expect(hrefs).not.toContain('#regular')
    // The one guaranteed link: the city's own calendar and Guide.
    expect(hrefs).toContain('/events?city=bursa')
    expect(hrefs).toContain('/guide?city=bursa')
  })

  it('points at the hub sections and guides when the city has them', () => {
    const steps = buildFirstWeek({
      ...base, citySlug: 'istanbul', cityName: 'Istanbul',
      guides: studentGuides([art('sim-card', 'Getting a SIM Card', 'Mobile & Digital')], 'c1'),
      audiences: [{ value: 'budget', label: 'On a budget' }],
      hasFirstEvents: true, hasRegular: true, hasNeighborhoods: true,
    })
    const hrefs = steps.flatMap(s => s.links.map(l => l.href))
    expect(hrefs).toEqual(expect.arrayContaining(['/handbook/sim-card', '/guide?for=budget', '#first-event', '#regular', '/neighborhoods']))
  })
})

describe('what the page promises', () => {
  const page = readFileSync(join(process.cwd(), 'app/[city]/students/page.tsx'), 'utf8')
  const code = page.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  it('invents no student discount, university partnership or eligibility rule', () => {
    expect(code).not.toMatch(/discount|partner(ship)?|student price|student rate|eligib/i)
  })

  it('carries the student marker to the application form', () => {
    expect(code).toContain('from="students"')
    const apply = readFileSync(join(process.cwd(), 'app/apply/ApplyClient.tsx'), 'utf8')
    expect(apply).toContain("searchParams.get('from') === 'students'")
  })

  it('is reachable from the homepage and the Discover menu', () => {
    const home = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8')
    expect(home).toContain('/students')
    expect(DISCOVER_LINKS.find(l => l.href === '/students')?.public).toBe(true)
  })
})
