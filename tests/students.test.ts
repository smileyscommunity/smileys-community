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

  it("keeps a non-default city on its guide links (no Istanbul breadcrumbs from /bursa/students)", () => {
    const steps = buildFirstWeek({
      ...base, guides: studentGuides([art('sim-card', 'Getting a SIM Card', 'Mobile & Digital')], 'c1'),
    })
    const hrefs = steps.flatMap(s => s.links.map(l => l.href))
    expect(hrefs).toContain('/handbook/sim-card?city=bursa')
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

// The hub's stories section reads one community-post category. Pin the seams:
// the category must be one the admin form can save (else it's unreachable),
// the loader must query it pinned to the city (another city's Erasmus piece
// is not this one's), and the title-match it replaced must not come back.
describe('student stories', () => {
  it('is a category the admin form and API accept', async () => {
    const { STUDENT_STORY_CATEGORY } = await import('@/lib/students')
    const { CATEGORIES, isCategory, normalizeCommunityCategory } = await import('@/app/admin/posts/constants')
    expect(CATEGORIES).toContain(STUDENT_STORY_CATEGORY)
    expect(isCategory(STUDENT_STORY_CATEGORY)).toBe(true)
    expect(normalizeCommunityCategory(STUDENT_STORY_CATEGORY)).toBe(STUDENT_STORY_CATEGORY)
  })

  it('the loader queries the category, pinned to the city, and no title match', () => {
    const src = readFileSync(join(process.cwd(), 'app/[city]/data.ts'), 'utf8')
    const loader = src.slice(src.indexOf('export const getCityStudentHub'), src.indexOf("['city-student-hub']"))
    expect(loader).toMatch(/category:\s*STUDENT_STORY_CATEGORY,\s*cityId\s*}/)
    expect(loader).not.toMatch(/contains:\s*'Erasmus'/)
    // The body is read for the cover only; it must not reach the page.
    expect(loader).toMatch(/cover:\s*articleCover/)
    expect(loader).not.toMatch(/stories:\s*stories,/)
  })

  it('every public badge map has a colour for it', () => {
    for (const f of ['app/posts/page.tsx', 'app/posts/[slug]/page.tsx', 'app/admin/posts/page.tsx']) {
      expect(readFileSync(join(process.cwd(), f), 'utf8'), f).toMatch(/'Students':\s*'bg-/)
    }
  })
})

// The 2026-09-29 review of the live Istanbul hub: an event that had ended at
// 21:00 still sat in "Something every week"; a guest saw only members-only
// cards; coworking sessions and a ₺1,200 boat trip filled a student's rows;
// "Renting a flat" opened the utilities article.
describe('student hub review 2026-09-29', () => {
  const weekly = (id: string, over: Partial<StudentEventLike> = {}) => ev({ id, seriesId: `s-${id}`, ...over })

  it('leaves coworking sessions to the remote-work hub, by title or club', () => {
    const events = [
      ev({ id: 'a', isFirstTimerFriendly: true, title: 'Coworking in Taksim' }),
      ev({ id: 'b', isFirstTimerFriendly: true, title: 'Picnic', clubName: 'Kadıköy Co-working Club' }),
      ev({ id: 'c', isFirstTimerFriendly: true, title: 'Newcomers drinks', clubName: 'Newcomers' }),
    ]
    expect(pickFirstEvents(events).map(e => e.id)).toEqual(['c'])
    expect(pickRegularEvents(events.map(e => ({ ...e, seriesId: `s-${e.id}` }))).map(e => e.id)).toEqual(['c'])
  })

  it('shows at most one paid weekly activity', () => {
    const events = [weekly('sail', { price: 1200 }), weekly('wine', { price: 300 }), weekly('picnic'), weekly('lang')]
    expect(pickRegularEvents(events).map(e => e.id)).toEqual(['sail', 'picnic', 'lang'])
  })

  it('puts open events first for a guest, and keeps the row in date order', () => {
    const events = [
      ev({ id: 'm1', isFirstTimerFriendly: true, membersOnly: true, date: '2026-10-01' }),
      ev({ id: 'm2', isFirstTimerFriendly: true, membersOnly: true, date: '2026-10-02' }),
      ev({ id: 'o1', isFirstTimerFriendly: true, membersOnly: false, date: '2026-10-03' }),
      ev({ id: 'm3', isFirstTimerFriendly: true, membersOnly: true, date: '2026-10-04' }),
      ev({ id: 'o2', isFirstTimerFriendly: true, membersOnly: false, date: '2026-10-05' }),
    ]
    expect(pickFirstEvents(events).map(e => e.id)).toEqual(['m1', 'm2', 'o1'])
    expect(pickFirstEvents(events, undefined, { preferOpen: true }).map(e => e.id)).toEqual(['m1', 'o1', 'o2'])
  })

  it('a series in the first-event row does not come back as its next date', () => {
    const events = [
      ev({ id: 'w1', seriesId: 's', isFirstTimerFriendly: true }),
      ev({ id: 'w2', seriesId: 's', isFirstTimerFriendly: true, date: '2026-10-08' }),
    ]
    expect(pickRegularEvents(events, new Set(['w1']))).toEqual([])
  })

  it('"Renting a flat" is the renting guide, not the moving-in one', () => {
    const articles = [
      art('moving-into-a-flat-in-istanbul-electricity-water-gas-and-aidat', 'Moving Into a Flat in Istanbul: Electricity, Water, Gas and the Building Fee (Aidat)', 'Home & Housing', 'ist'),
      art('istanbul-apartment-hunting-guide', 'Renting an Apartment in Istanbul: What Foreigners Should Know', 'Home & Housing', 'ist'),
    ]
    expect(studentGuides(articles, 'ist').find(g => g.key === 'housing')?.article.slug).toBe('istanbul-apartment-hunting-guide')
    expect(studentGuides(articles.slice(0, 1), 'ist').find(g => g.key === 'housing')).toBeUndefined()
  })

  it('the loader cuts on the real end, and picks for guests and members', () => {
    const src = readFileSync(join(process.cwd(), 'app/[city]/data.ts'), 'utf8')
    const loader = src.slice(src.indexOf('export const getCityStudentHub'), src.indexOf("['city-student-hub']"))
    expect(loader).toMatch(/eventEndsAt\(e, timeZone\)\.getTime\(\) > now/)
    expect(loader).toMatch(/forGuests:\s*pick\(true\)/)
    expect(loader).not.toMatch(/pickFirstEvents\(events/)
  })

  it('the page shares its own cover, tells guests about 🔒 once, and stacks on phones', () => {
    const page = readFileSync(join(process.cwd(), 'app/[city]/students/page.tsx'), 'utf8')
    expect(page).toContain("shareCover('students', city, title)")
    expect(page).toContain('session ? hub.forMembers : hub.forGuests')
    expect(page).toContain('guestLocked &&')
    // Stacked grids on phones, not sideways swipe rows (Nate, 2026-09-29).
    expect(page).not.toContain('snap-x')
    expect(page).not.toContain('Links official sources')
    expect(page).not.toMatch(/Explore \{city\.name\}\{budget/)
  })
})

// Add-ons 2026-09-29: a counted student line, hosts, an FAQ with JSON-LD and
// an ESN pointer. The count and the English claim must never overstate.
describe('student hub add-ons', () => {
  it('rounds the student count down and hides a small one', async () => {
    const { studentCountLabel, STUDENT_PROOF_MIN } = await import('@/lib/students')
    expect(studentCountLabel(202)).toBe('200+')
    expect(studentCountLabel(149)).toBe('100+')
    expect(studentCountLabel(57)).toBe('50+')
    expect(studentCountLabel(STUDENT_PROOF_MIN - 1)).toBeNull()
    expect(studentCountLabel(1234)).toBe('1200+')
    expect(studentCountLabel(NaN)).toBeNull()
  })

  it('does not count "Education" as a student reason (it is as likely a teacher)', async () => {
    const { STUDENT_REASON_SQL } = await import('@/lib/students')
    const re = new RegExp(STUDENT_REASON_SQL, 'i')
    for (const r of ['Study', 'Studying', 'University', ' student']) expect(re.test(r), r).toBe(true)
    expect(re.test('Education')).toBe(false)
    expect(re.test('Work')).toBe(false)
  })

  it('says "most events are in English" only when more than half are', async () => {
    const { mostlyEnglish, studentFaqs } = await import('@/lib/students')
    expect(mostlyEnglish([{ language: 'English ' }, { language: 'english' }, { language: 'Turkish' }])).toBe(true)
    expect(mostlyEnglish([{ language: 'English' }, { language: 'Turkish' }])).toBe(false)
    expect(mostlyEnglish([{ language: 'English', status: 'cancelled' }, { language: 'Turkish' }])).toBe(false)
    expect(mostlyEnglish([])).toBe(false)
    const turkish = studentFaqs({ cityName: 'Bursa', mostlyEnglish: false }).find(f => /local language/.test(f.q))!
    expect(turkish.a).not.toMatch(/most events/)
  })

  it('the count loader counts activated members, by parameterised pattern, and returns only a number', () => {
    const src = readFileSync(join(process.cwd(), 'app/[city]/data.ts'), 'utf8')
    const fn = src.slice(src.indexOf('export const getCityStudentCount'), src.indexOf("['city-student-count']"))
    expect(fn).toMatch(/u\."status" = 'approved' AND u\."password" IS NOT NULL/)
    expect(fn).toContain('~* ${STUDENT_REASON_SQL}')
    expect(fn).toMatch(/Promise<number>/)
  })

  it('the page escapes its FAQ JSON-LD and reads hosts per viewer, outside the hub cache', () => {
    const page = readFileSync(join(process.cwd(), 'app/[city]/students/page.tsx'), 'utf8')
    expect(page).toContain(".replace(/</g, '\\\\u003c')")
    expect(page).toContain('getCityHosts(city, session)')
    const data = readFileSync(join(process.cwd(), 'app/[city]/data.ts'), 'utf8')
    const hub = data.slice(data.indexOf('export const getCityStudentHub'), data.indexOf("['city-student-hub']"))
    expect(hub).not.toMatch(/getCityHosts|getCityHostRoster/)
    expect(page).toMatch(/ESN \(Erasmus Student Network\)/)
  })
})
