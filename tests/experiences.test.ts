import { describe, it, expect } from 'vitest'
import { buildCards, buildShelves, experienceWindow, type ExperienceEventLike } from '@/lib/experiences'

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
  it('puts an event on every Experience shelf it is tagged with, in curated order', () => {
    const shelves = buildShelves([
      ev({ id: 'x', date: '2026-10-01', tags: [tag('Games'), tag('Cultural'), tag('Outdoor')] }),
      ev({ id: 'y', date: '2026-10-02', tags: [tag('Food'), { tag: { name: 'Chill', emoji: '·', group: { name: 'Energy' } } }] }),
    ])
    expect(shelves.map(s => s.name)).toEqual(['Outdoor', 'Cultural', 'Food', 'Games'])
    expect(shelves.find(s => s.name === 'Food')!.cards.map(c => c.event.id)).toEqual(['y'])
  })
})
