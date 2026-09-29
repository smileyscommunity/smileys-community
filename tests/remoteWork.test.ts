import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  groupHubArticles, buildChecklist, isWorkClub, utcOffsetLabel, pickHubEvents, workdayOverlap, coworkingWeek,
  ARTICLES_PER_TOPIC, HUB_WORK_EVENT_CAP, INTERVIEW_CATEGORY, NOMINATE_TOPIC, nominateHref,
  type HubArticle,
} from '@/lib/remoteWork'
import { goodToKnowRows } from '@/lib/eventGoodToKnow'
import { CATEGORIES, isCategory } from '@/app/admin/posts/constants'
import { isSeriesCategory } from '@/lib/postSeries'

const src = (p: string) => readFileSync(p, 'utf8')

// The remote-work hub may only point at content the city actually has. These
// pin the rules in lib/remoteWork (and the event "Good to know" rows) that
// keep it from promising a topic, a coworking session or an event detail
// that isn't there.

const article = (over: Partial<HubArticle>): HubArticle => ({
  slug: 'x', title: 'X', excerpt: null, category: 'Money & Banking', cityId: null,
  lastReviewedAt: null, reviewIntervalDays: null, hasOfficialSources: false, ...over,
})

describe('groupHubArticles', () => {
  it('drops a topic the city has no article for', () => {
    const topics = groupHubArticles([article({ slug: 'bank', category: 'Money & Banking' })], 'c1')
    expect(topics.map(t => t.key)).toEqual(['money'])
  })

  it('resolves legacy category keys (Bureaucracy → Residence & Legal)', () => {
    const topics = groupHubArticles([article({ slug: 'permit', title: 'Residence permit', category: 'Bureaucracy' })], 'c1')
    expect(topics).toEqual([expect.objectContaining({ key: 'legal', articles: [expect.objectContaining({ slug: 'permit' })] })])
  })

  it('ranks the on-topic article over a broad-category neighbour', () => {
    // 'Daily Life' is filed under Home & Housing; the apartment guide is the housing answer.
    const topics = groupHubArticles([
      article({ slug: 'daily-life', title: 'Daily life: the little things', category: 'Daily Life' }),
      article({ slug: 'apartment-hunting', title: 'Renting an apartment', category: 'Living in Istanbul' }),
    ], 'c1')
    // …and the off-topic neighbour doesn't take the second slot.
    expect(topics[0].articles.map(a => a.slug)).toEqual(['apartment-hunting'])
  })

  it('never fills the second slot with an off-topic article (e-Devlet is not a SIM guide)', () => {
    const topics = groupHubArticles([
      article({ slug: 'sim', title: 'Getting a SIM card and home internet', category: 'Mobile & Digital' }),
      article({ slug: 'e-devlet', title: 'e-Devlet for foreigners', category: 'Mobile & Digital' }),
    ], 'c1')
    expect(topics[0].articles.map(a => a.slug)).toEqual(['sim'])
  })

  it('still leads with the best article when none is on-topic', () => {
    const topics = groupHubArticles([article({ slug: 'e-devlet', title: 'e-Devlet for foreigners', category: 'Mobile & Digital' })], 'c1')
    expect(topics[0].articles.map(a => a.slug)).toEqual(['e-devlet'])
  })

  it('leads money with the bank account, not the tax number listed first', () => {
    const topics = groupHubArticles([
      article({ slug: 'tax-number', title: 'Getting a Turkish tax number', cityId: null }),
      article({ slug: 'bank', title: 'Opening a Turkish bank account', cityId: null }),
    ], 'c1')
    expect(topics[0].articles.map(a => a.slug)).toEqual(['bank', 'tax-number'])
    expect(buildChecklist({ citySlug: 'istanbul', topics, hasNeighborhoods: true, hasWorkClubs: false, hasWorkEvents: false, hasEvents: false })
      .find(s => s.key === 'money')?.href).toBe('/handbook/bank')
  })

  it('keeps the airport guide in Getting around', () => {
    const topics = groupHubArticles([
      article({ slug: 'istanbulkart', title: 'Istanbulkart Mastery', category: 'Getting Around', cityId: 'c1' }),
      article({ slug: 'arriving-in-istanbul', title: 'Arriving in Istanbul: IST and Sabiha Gökçen', category: 'Getting Around', cityId: 'c1' }),
    ], 'c1')
    expect(topics[0].articles.map(a => a.slug)).toEqual(['istanbulkart', 'arriving-in-istanbul'])
  })

  it("puts the city's own article ahead of the national one, and caps the topic", () => {
    const topics = groupHubArticles([
      article({ slug: 'national-bank', title: 'Opening a bank account', cityId: null }),
      article({ slug: 'city-bank', title: 'Opening a bank account here', cityId: 'c1' }),
      article({ slug: 'other-city-bank', title: 'Bank account', cityId: null }),
    ], 'c1')
    expect(topics[0].articles[0].slug).toBe('city-bank')
    expect(topics[0].articles).toHaveLength(ARTICLES_PER_TOPIC)
  })

  it('ignores articles in an unknown category rather than inventing a topic', () => {
    expect(groupHubArticles([article({ category: 'Nonsense' })], 'c1')).toEqual([])
  })
})

describe('Health and insurance topic', () => {
  it('files the health-insurance guide under its own topic, last', () => {
    const topics = groupHubArticles([
      article({ slug: 'bank', title: 'Bank account' }),
      article({ slug: 'hi', title: 'Health Insurance for Your Residence Permit', category: 'Healthcare' }),
    ], 'c1')
    expect(topics.map(t => t.key)).toEqual(['money', 'health'])
  })
})

describe('workdayOverlap', () => {
  it('reads a London/Berlin/NY/SF 9-to-5 in Istanbul time in summer', () => {
    expect(workdayOverlap('Europe/Istanbul', new Date('2026-07-15T12:00:00Z'))).toEqual([
      { label: 'London', start: '11:00', end: '19:00' },
      { label: 'Berlin', start: '10:00', end: '18:00' },
      { label: 'New York', start: '16:00', end: '00:00' },
      { label: 'San Francisco', start: '19:00', end: '03:00' },
    ])
  })
  it('follows each side’s DST change — Europe and the US switch on different weekends', () => {
    // 30 Oct 2026: Europe is back on winter time, the US not until 1 Nov.
    const gap = workdayOverlap('Europe/Istanbul', new Date('2026-10-30T12:00:00Z'))
    expect(gap.find(o => o.label === 'London')).toMatchObject({ start: '12:00', end: '20:00' })
    expect(gap.find(o => o.label === 'New York')).toMatchObject({ start: '16:00', end: '00:00' })
    const winter = workdayOverlap('Europe/Istanbul', new Date('2026-12-15T12:00:00Z'))
    expect(winter.find(o => o.label === 'New York')).toMatchObject({ start: '17:00', end: '01:00' })
  })
  it('leaves out a home zone on the city’s own offset', () => {
    expect(workdayOverlap('Europe/London', new Date('2026-07-15T12:00:00Z')).map(o => o.label)).not.toContain('London')
  })
})

describe('coworkingWeek', () => {
  const s = (date: string, neighborhood: string | null = null) => ({ date, neighborhood })
  it('counts every session in the next 7 days and lists the places once, soonest first', () => {
    expect(coworkingWeek([s('2026-10-06', 'Bomonti'), s('2026-09-30', 'Kadıköy'), s('2026-10-01', 'Beyoğlu'), s('2026-10-07', 'Kadıköy'), s('2026-10-02', 'Kadıköy')], '2026-09-30'))
      .toEqual({ count: 4, places: ['Kadıköy', 'Beyoğlu', 'Bomonti'] })
  })
  it('is null on an empty week, and ignores past sessions', () => {
    expect(coworkingWeek([s('2026-09-29', 'Kadıköy'), s('2026-10-08', 'Kadıköy')], '2026-09-30')).toBeNull()
  })
})

describe('isWorkClub', () => {
  it.each(['Coworking', 'Remote Workers', 'Digital Nomads', 'Newcomers', 'Co-working Kadıköy'])('matches %s', name => {
    expect(isWorkClub(name)).toBe(true)
  })
  it.each(['After Work', 'Breathwork', 'Book Club', 'Networking'])('does not match %s', name => {
    // "After Work" is drinks, "Breathwork" is wellness — neither is a place to work.
    expect(isWorkClub(name)).toBe(false)
  })
})

describe('utcOffsetLabel', () => {
  it('reads a fixed-offset zone', () => {
    expect(utcOffsetLabel('Europe/Istanbul', new Date('2026-01-15T12:00:00Z'))).toBe('UTC+3')
  })
  it('follows DST in both halves of the year', () => {
    expect(utcOffsetLabel('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe('UTC−5')
    expect(utcOffsetLabel('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe('UTC−4')
  })
  it('falls back to the default zone for a bad admin value instead of throwing', () => {
    expect(() => utcOffsetLabel('EUROPE')).not.toThrow()
  })
})

describe('buildChecklist', () => {
  const topics = groupHubArticles([
    article({ slug: 'sim', title: 'SIM card and home internet', category: 'Mobile & Digital' }),
    article({ slug: 'bank', title: 'Bank account', category: 'Money & Banking' }),
  ], 'c1')
  const base = { citySlug: 'izmir', topics, hasNeighborhoods: true, hasWorkClubs: true, hasWorkEvents: true, hasEvents: true }

  it('gives five steps, each linked to the page that answers it', () => {
    const steps = buildChecklist(base)
    expect(steps.map(s => s.key)).toEqual(['connect', 'neighbourhood', 'workspace', 'money', 'first-event'])
    expect(steps.find(s => s.key === 'connect')?.href).toBe('/handbook/sim')
    expect(steps.find(s => s.key === 'neighbourhood')?.href).toBe('/neighborhoods?city=izmir')
    expect(steps.find(s => s.key === 'money')?.href).toBe('/handbook/bank')
  })

  it('does not claim coworking sessions a city does not have', () => {
    const none = buildChecklist({ ...base, hasWorkClubs: false, hasWorkEvents: false })
    const step = none.find(s => s.key === 'workspace')!
    expect(step.href).toBeNull()
    expect(step.body).not.toMatch(/regular coworking sessions/)

    const clubsOnly = buildChecklist({ ...base, hasWorkEvents: false }).find(s => s.key === 'workspace')!
    expect(clubsOnly.body).not.toMatch(/regular coworking sessions/)
  })

  it('leaves a step unlinked when the Handbook has nothing for it', () => {
    const steps = buildChecklist({ ...base, topics: [] })
    expect(steps.find(s => s.key === 'connect')?.href).toBeNull()
    expect(steps.find(s => s.key === 'money')?.href).toBeNull()
  })

  it('sends the first-event step to the events hub when nothing is featured', () => {
    expect(buildChecklist({ ...base, hasEvents: false }).find(s => s.key === 'first-event')?.href).toBe('/izmir/events')
  })
})

describe('goodToKnowRows', () => {
  const bare = { isFirstTimerFriendly: false, language: null, approvalRequired: false, refundPolicy: null, limitedSpots: false, totalSpots: 20, status: 'published' }

  it('renders nothing event-specific when no field is set — no invented defaults', () => {
    expect(goodToKnowRows(bare)).toEqual([])
  })

  it('shows only the populated fields', () => {
    const rows = goodToKnowRows({ ...bare, language: ' English ', isFirstTimerFriendly: true, refundPolicy: 'Full refund up to 48h before.' })
    expect(rows.map(r => r.key)).toEqual(['first-timer', 'language', 'refund'])
    expect(rows.find(r => r.key === 'language')?.text).toBe('English')
  })

  it('states a group size only for capped events', () => {
    expect(goodToKnowRows({ ...bare, totalSpots: 12 }).some(r => r.key === 'size')).toBe(false)
    expect(goodToKnowRows({ ...bare, limitedSpots: true, totalSpots: 12 }).find(r => r.key === 'size')?.text).toBe('Up to 12 people')
  })
})

describe('pickHubEvents', () => {
  const WORK = new Set(['cowork'])
  // Istanbul's calendar on 2026-09-24, in date order: three weekly coworking
  // series that filled all six places, and the first-timer events they hid.
  const cal = [
    { id: 'b1', date: '2026-09-25', title: 'Coworking in Beyoglu', clubId: 'cowork', seriesId: null },
    { id: 'p1', date: '2026-09-26', title: 'Picnic in Moda', clubId: 'picnic', seriesId: 'picnic', isFirstTimerFriendly: true },
    { id: 'h1', date: '2026-09-27', title: 'Hiking in Büyükada', clubId: 'hiking', seriesId: null, isFirstTimerFriendly: true },
    { id: 'm1', date: '2026-09-29', title: 'Coworking in Bomonti', clubId: 'cowork', seriesId: 'bomonti' },
    { id: 'k1', date: '2026-09-30', title: 'Coworking Kadıköy', clubId: 'cowork', seriesId: 'kadikoy' },
    { id: 's1', date: '2026-09-30', title: "Let's Get Social", clubId: 'speak', seriesId: 'social', isFirstTimerFriendly: true },
    { id: 'p2', date: '2026-10-03', title: 'Picnic in Moda', clubId: 'picnic', seriesId: 'picnic', isFirstTimerFriendly: true },
    { id: 'm2', date: '2026-10-06', title: 'Coworking in Bomonti', clubId: 'cowork', seriesId: 'bomonti' },
    { id: 'k2', date: '2026-10-07', title: 'Coworking Kadıköy', clubId: 'cowork', seriesId: 'kadikoy' },
    { id: 'm3', date: '2026-10-13', title: 'Coworking in Bomonti', clubId: 'cowork', seriesId: 'bomonti' },
    { id: 'x1', date: '2026-10-01', title: 'Theatre', clubId: 'theatre', seriesId: null },
  ]

  it('shows each weekly session once, and never crowds out first-timer events', () => {
    const ids = pickHubEvents(cal, WORK, 6).map(e => e.id)
    expect(ids).toEqual(['b1', 'p1', 'h1', 'm1', 'k1', 's1'])
  })

  it('caps coworking when there are enough first-timer events, and backfills when there are not', () => {
    const onlyWork = cal.filter(e => e.clubId === 'cowork')
    expect(pickHubEvents(onlyWork, WORK, 6).map(e => e.id)).toEqual(['b1', 'm1', 'k1'])   // 3 distinct sessions
    const manyNewbies = [...cal, ...['a', 'b', 'c', 'd'].map((x, i) => ({ id: x, date: `2026-10-2${i}`, title: x, clubId: x, seriesId: null, isFirstTimerFriendly: true }))]
    expect(pickHubEvents(manyNewbies, WORK, 6).filter(e => e.clubId === 'cowork')).toHaveLength(HUB_WORK_EVENT_CAP)
  })

  it('leaves out ordinary events, cancelled ones, and keeps date order', () => {
    const picked = pickHubEvents([...cal, { id: 'c', date: '2026-09-24', title: 'x', clubId: 'cowork', seriesId: 'z', status: 'cancelled' }], WORK, 6)
    expect(picked.some(e => e.id === 'x1' || e.id === 'c')).toBe(false)
    expect(picked.map(e => e.date)).toEqual([...picked.map(e => e.date)].sort())
  })
})

describe('buildChecklist — arrival and membership', () => {
  const topics = groupHubArticles([
    article({ slug: 'bank', title: 'Bank account', category: 'Money & Banking' }),
    article({ slug: 'istanbulkart-mastery', title: 'Istanbulkart Mastery', category: 'Getting Around', cityId: 'c1' }),
    article({ slug: 'arriving-in-istanbul', title: 'Arriving in Istanbul: from the airport', category: 'Getting Around', cityId: 'c1' }),
  ], 'c1')
  const base = { citySlug: 'istanbul', topics, hasNeighborhoods: true, hasWorkClubs: true, hasWorkEvents: true, hasEvents: true }

  it('links transport and the airport guide beside money', () => {
    const step = buildChecklist(base).find(s => s.key === 'money')!
    expect(step.href).toBe('/handbook/bank')
    expect(step.more).toEqual([
      { href: '/handbook/istanbulkart-mastery', cta: 'Read the transport guide' },
      { href: '/handbook/arriving-in-istanbul', cta: 'From the airport into the city' },
    ])
  })

  it('says coworking is for members when every session is members-only', () => {
    const open = buildChecklist(base).find(s => s.key === 'workspace')!
    const closed = buildChecklist({ ...base, workMembersOnly: true }).find(s => s.key === 'workspace')!
    expect(open.body).not.toMatch(/members:/)
    expect(closed.body).toMatch(/for members: joining is free/)
  })
})

// ── "Working from …" interviews ─────────────────────────────────────────────
//
// The hub's interview card is an ordinary community post in one category.
// These pin the seams: the category the loader queries must be one the admin
// form can save, the series Next link must stay inside the city, the loader
// must filter on the city (not the listing scope) and cache no byline, and
// the nomination must arrive at the contact form as a topic it knows.
describe('Working from interviews', () => {
  it('is a category the admin form and API accept', () => {
    expect(CATEGORIES).toContain(INTERVIEW_CATEGORY)
    expect(isCategory(INTERVIEW_CATEGORY)).toBe(true)
  })

  it('runs as a series, and the Next link stays inside the city', () => {
    expect(isSeriesCategory(INTERVIEW_CATEGORY)).toBe(true)
    // getNextInSeries filters on cityId: Istanbul's interview must not hand
    // the reader İzmir's as "next".
    const series = src('lib/postSeries.ts')
    expect(series).toMatch(/where:\s*\{[^}]*\bcityId\b[^}]*publishedAt: \{ gt:/)
    expect(src('app/posts/[slug]/page.tsx')).toMatch(/getNextInSeries\([\s\S]{0,200}post\.cityId/)
  })

  it('the loader takes only this city\'s interview and caches no author fields', () => {
    const loader = src('app/[city]/data.ts')
    const query  = loader.slice(loader.indexOf('category: INTERVIEW_CATEGORY'))
    // The city itself, not postCityScope: a global interview belongs to no hub.
    expect(query).toMatch(/^[^\n]*\bcityId \}/m)
    expect(loader.slice(loader.indexOf('getCityRemoteWorkHub'), loader.indexOf("['city-remote-work-hub']"))).not.toMatch(/author: \{ select/)
    // The page projects the byline per request through the shared rule.
    const page = src('app/[city]/remote-work/page.tsx')
    expect(page).toContain("from '@/lib/storyByline'")
    expect(page).toMatch(/storyBylines\(session/)
  })

  it('nominating goes to the contact form as a topic it labels', () => {
    expect(nominateHref('İzmir')).toBe('/contact?topic=nominate&city=%C4%B0zmir')
    expect(src('app/api/contact/route.ts')).toMatch(new RegExp(`^\\s*${NOMINATE_TOPIC}:\\s+'`, 'm'))
    expect(src('app/contact/page.tsx')).toContain(`value: '${NOMINATE_TOPIC}'`)
    // Members only on the page — a guest gets the join button, not a nomination link.
    expect(src('app/[city]/remote-work/page.tsx')).toMatch(/\{session && \([\s\S]{0,400}nominateHref\(/)
  })
})
