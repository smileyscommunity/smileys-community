import { describe, it, expect } from 'vitest'
import {
  groupHubArticles, buildChecklist, isWorkClub, utcOffsetLabel, pickHubEvents,
  ARTICLES_PER_TOPIC, HUB_WORK_EVENT_CAP, type HubArticle,
} from '@/lib/remoteWork'
import { goodToKnowRows } from '@/lib/eventGoodToKnow'

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
    expect(topics[0].articles.map(a => a.slug)).toEqual(['apartment-hunting', 'daily-life'])
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
