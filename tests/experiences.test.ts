import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildCards, buildShelves, describeShelves, experienceWindow, primaryShelf, SHELF_ORDER, type ExperienceEventLike } from '@/lib/experiences'

// The experiences page mirrors the events feed on three rules it used to get
// wrong: a started event drops after the same grace, a cancelled occurrence is
// shown (or named as a skipped date) rather than vanishing, and a full event
// says so. These pin them.

const tag = (name: string) => ({ tag: { name, emoji: '·', group: { name: 'Experience' } } })
const ev = (over: Partial<ExperienceEventLike> & { id: string; date: string }): ExperienceEventLike => ({
  title: over.id, time: '17:00', seriesId: null, isRecurring: false, status: 'published',
  limitedSpots: true, spotsLeft: 5, soldOut: false, tags: [tag('Outdoor')], ...over,
})

describe('experienceWindow', () => {
  it('keeps an event for 5h after its start, in the city clock passed in', () => {
    const w = experienceWindow({ date: '2026-09-27', hour: 16, minute: 10, minutes: 16 * 60 + 10, weekdayShort: 'Sun' })
    expect(w).toEqual({ today: '2026-09-27', cutoffTime: '11:10' })
  })
  it('clamps at midnight instead of producing a negative time', () => {
    const w = experienceWindow({ date: '2026-09-27', hour: 1, minute: 27, minutes: 87, weekdayShort: 'Sun' })
    expect(w.cutoffTime).toBe('00:00')
  })
})

describe('buildCards', () => {
  it('flags a full event as sold out instead of showing it bookable', () => {
    const [card] = buildCards([ev({ id: 'hike', date: '2026-09-27', spotsLeft: 0 })])
    expect(card.soldOut).toBe(true)
    expect(card.cancelled).toBe(false)
  })

  it('does not call an unlimited event with 0 spots sold out', () => {
    const [card] = buildCards([ev({ id: 'walk', date: '2026-09-27', spotsLeft: 0, limitedSpots: false })])
    expect(card.soldOut).toBe(false)
  })

  it('keeps a standalone cancelled event as a stamped card', () => {
    const cards = buildCards([ev({ id: 'play', date: '2026-09-28', status: 'cancelled' })])
    expect(cards).toHaveLength(1)
    expect(cards[0].cancelled).toBe(true)
  })

  it('cards a series on its next live date and names the cancelled one it skips', () => {
    const cards = buildCards([
      ev({ id: 's1', date: '2026-09-27', seriesId: 'sail', status: 'cancelled' }),
      ev({ id: 's2', date: '2026-10-04', seriesId: 'sail' }),
      ev({ id: 's3', date: '2026-10-11', seriesId: 'sail' }),
      ev({ id: 's4', date: '2026-10-18', seriesId: 'sail' }),
      ev({ id: 's5', date: '2026-10-25', seriesId: 'sail' }),
    ])
    expect(cards).toHaveLength(1)
    const [card] = cards
    expect(card.event.id).toBe('s2')
    expect(card.cancelled).toBe(false)
    expect(card.cadence).toBe('Every Sunday')
    expect(card.cancelledDates).toEqual(['2026-09-27'])
    expect(card.moreDates).toEqual(['2026-10-11', '2026-10-18'])
    expect(card.moreCount).toBe(3)
  })

  it('a later cancelled occurrence is not reported as skipped', () => {
    const [card] = buildCards([
      ev({ id: 's2', date: '2026-10-04', seriesId: 'sail' }),
      ev({ id: 's3', date: '2026-10-11', seriesId: 'sail', status: 'cancelled' }),
    ])
    expect(card.event.id).toBe('s2')
    expect(card.cancelledDates).toEqual([])
    expect(card.moreDates).toEqual([])
  })

  it('a series with every date cancelled still gets one cancelled card', () => {
    const cards = buildCards([
      ev({ id: 's1', date: '2026-09-27', seriesId: 'sail', status: 'cancelled' }),
      ev({ id: 's2', date: '2026-10-04', seriesId: 'sail', status: 'cancelled' }),
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0].cancelled).toBe(true)
    expect(cards[0].event.id).toBe('s1')
  })

  it('orders cards chronologically across live and cancelled', () => {
    const cards = buildCards([
      ev({ id: 'b', date: '2026-10-03' }),
      ev({ id: 'a', date: '2026-09-28', status: 'cancelled' }),
    ])
    expect(cards.map(c => c.event.id)).toEqual(['a', 'b'])
  })
})

describe('buildShelves', () => {
  it('puts an event on ONE shelf — the first of its Experience tags in the curated order', () => {
    const shelves = buildShelves([
      ev({ id: 'walk', date: '2026-10-01', tags: [tag('Sports'), tag('Nightlife'), tag('Cultural'), tag('Outdoor')] }),
      ev({ id: 'play', date: '2026-10-02', tags: [tag('Games'), tag('Cultural')] }),
      ev({ id: 'dinner', date: '2026-10-03', tags: [tag('Food'), { tag: { name: 'Chill', emoji: '·', group: { name: 'Energy' } } }] }),
    ])
    expect(shelves.map(s => s.name)).toEqual(['Outdoor', 'Cultural', 'Food'])
    expect(shelves.flatMap(s => s.cards.map(c => c.event.id))).toEqual(['walk', 'play', 'dinner'])
  })
  it('every tag in the Experience group has a place in the order; an unknown one sorts last', () => {
    for (const name of ['Adventure', 'Books', 'Cultural', 'Dance', 'Film', 'Food', 'Games', 'Music', 'Nightlife', 'On the water', 'Outdoor', 'Sports', 'Wellness']) {
      expect(SHELF_ORDER, name).toContain(name)
    }
    expect(primaryShelf(ev({ id: 'x', date: '2026-10-01', tags: [tag('Karaoke'), tag('Nightlife')] }))?.name).toBe('Nightlife')
    expect(primaryShelf(ev({ id: 'y', date: '2026-10-01', tags: [{ tag: { name: 'Chill', emoji: '·', group: { name: 'Energy' } } }] }))).toBeNull()
  })
})

describe('describeShelves', () => {
  it('names what is on the page, at most four shelves, as a sentence opener', () => {
    expect(describeShelves(['Outdoor', 'Adventure', 'Cultural', 'Food', 'Games'])).toBe('Outdoor days, adventures, culture and food')
    expect(describeShelves(['Cultural'])).toBe('Culture')
    expect(describeShelves(['On the water', 'Nightlife'])).toBe('Days on the water and nights out')
  })
  it('is null with nothing on the shelves, so the page writes the honest line instead', () => {
    expect(describeShelves([])).toBeNull()
  })
})

// Source-level promises of the two pages: the global page resolves its city
// the way /events does (so a crawler with no cookie gets the city in the
// URL), both emit the list as structured data, and the sitemap advertises
// both the global page and every other city's hub.
describe('experiences pages (source)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('the global page follows the ?city= + canonical rule of /events', () => {
    const src = read('app/experiences/page.tsx')
    expect(src).toContain("resolveCityForPage(searchParams)")
    expect(src).toContain("redirect(`/experiences?city=${city.slug}`)")
    expect(src).toContain("`${APP_URL}/${city.slug}/experiences`")
    expect(src).toContain("shareCover('experiences'")
    expect(src).toContain("eventListJsonLd(events.filter(e => e.status !== 'cancelled')")
  })
  it('the city hub is canonical by the shared rule and carries the same data', () => {
    const src = read('app/[city]/experiences/page.tsx')
    expect(src).toContain("hubCanonical(city.slug, 'experiences')")
    expect(src).toContain("eventListJsonLd(")
    expect(src).toContain("getExperiencesData(city.id)")
  })
  it('the sitemap lists /experiences and the per-city hubs', () => {
    const src = read('app/sitemap.ts')
    expect(src).toContain('`${BASE}/experiences`')
    expect(src).toContain('`${BASE}/${c.slug}/experiences`')
  })
})
