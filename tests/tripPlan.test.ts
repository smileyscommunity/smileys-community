import { describe, it, expect } from 'vitest'
import {
  parseTripRange, parseTripFilters, applyTripFilters, tripFilterOptions, tripEventWhen,
  cityAvailability, isFreeEvent, type TripEvent,
} from '@/lib/tripPlan'

// The /visiting trip planner must never show the past as upcoming, and must
// never offer a filter that can't narrow anything. These pin both.

const TODAY = '2026-09-23'
const TZ = 'Europe/Istanbul'

describe('parseTripRange', () => {
  it('treats no dates as "not planning yet", not an error', () => {
    expect(parseTripRange({}, TODAY)).toEqual({ range: null, error: null, clamped: false })
  })

  it('accepts an upcoming stay as given', () => {
    expect(parseTripRange({ from: '2026-10-01', to: '2026-10-05' }, TODAY))
      .toEqual({ range: { from: '2026-10-01', to: '2026-10-05' }, error: null, clamped: false })
  })

  it('refuses a stay that has already ended', () => {
    const r = parseTripRange({ from: '2026-09-01', to: '2026-09-10' }, TODAY)
    expect(r.range).toBeNull()
    expect(r.error).toMatch(/already passed/)
  })

  it('clamps a stay that already started to today, and says so', () => {
    expect(parseTripRange({ from: '2026-09-20', to: '2026-09-26' }, TODAY))
      .toEqual({ range: { from: TODAY, to: '2026-09-26' }, error: null, clamped: true })
  })

  it('rejects half a range, reversed dates, impossible dates and over-long stays', () => {
    expect(parseTripRange({ from: '2026-10-01' }, TODAY).error).toMatch(/both/)
    expect(parseTripRange({ from: '2026-10-05', to: '2026-10-01' }, TODAY).error).toMatch(/before your arrival/)
    expect(parseTripRange({ from: '2026-02-31', to: '2026-03-02' }, TODAY).error).toMatch(/both/)
    expect(parseTripRange({ from: '2026-10-01', to: '2027-02-01' }, TODAY).error).toMatch(/up to 90 days/)
  })
})

const ev = (over: Partial<TripEvent> = {}): TripEvent => ({
  date: '2026-10-02', time: '19:00', endTime: null, neighborhood: 'Kadıköy',
  price: 0, memberPrice: null, isFirstTimerFriendly: false, language: null, ...over,
})

describe('filters', () => {
  const events = [
    ev({ neighborhood: 'Kadıköy', price: 0, isFirstTimerFriendly: true, language: 'English' }),
    ev({ neighborhood: 'Beyoğlu', price: 200, language: 'Turkish' }),
    ev({ neighborhood: 'Moda', price: 500, memberPrice: 0 }),
  ]

  it('offers only filters that would narrow the list', () => {
    expect(tripFilterOptions(events)).toEqual({
      hoods: ['Beyoğlu', 'Kadıköy', 'Moda'], free: true, first: true, langs: ['English', 'Turkish'],
    })
    // Everything free, one neighbourhood, nothing first-timer, no language: nothing to offer.
    expect(tripFilterOptions([ev(), ev()])).toEqual({ hoods: [], free: false, first: false, langs: [] })
  })

  it('counts a zero member price as free, like the events feed', () => {
    expect(isFreeEvent(ev({ price: 500, memberPrice: 0 }))).toBe(true)
    expect(applyTripFilters(events, parseTripFilters({ free: '1' })).map(e => e.neighborhood)).toEqual(['Kadıköy', 'Moda'])
  })

  it('combines filters, and matches language case-insensitively', () => {
    const f = parseTripFilters({ first: '1', lang: 'english' })
    expect(applyTripFilters(events, f)).toHaveLength(1)
    expect(applyTripFilters(events, parseTripFilters({ hood: 'Beyoğlu' }))).toHaveLength(1)
    expect(applyTripFilters(events, parseTripFilters({}))).toHaveLength(3)
  })
})

describe('tripEventWhen', () => {
  // 2026-09-23 14:00 in Istanbul (UTC+3).
  const now = new Date('2026-09-23T11:00:00Z')

  it('drops past days and events already over today', () => {
    expect(tripEventWhen(ev({ date: '2026-09-22' }), TZ, TODAY, now)).toBeNull()
    expect(tripEventWhen(ev({ date: TODAY, time: '10:00', endTime: '12:00' }), TZ, TODAY, now)).toBeNull()
  })

  it('labels an event in progress, one later today, tomorrow, and later', () => {
    expect(tripEventWhen(ev({ date: TODAY, time: '13:00', endTime: '16:00' }), TZ, TODAY, now)?.kind).toBe('now')
    expect(tripEventWhen(ev({ date: TODAY, time: '19:00' }), TZ, TODAY, now)).toEqual({ kind: 'today', label: 'Today' })
    expect(tripEventWhen(ev({ date: '2026-09-24' }), TZ, TODAY, now)).toEqual({ kind: 'tomorrow', label: 'Tomorrow' })
    expect(tripEventWhen(ev({ date: '2026-10-02' }), TZ, TODAY, now)).toEqual({ kind: 'later', label: 'Fri 2 Oct' })
  })
})

describe('cityAvailability', () => {
  it('separates active, founding and coming-soon cities', () => {
    expect(cityAvailability({ status: 'live', stats: { maturity: 'self_sustaining' } })).toBe('active')
    expect(cityAvailability({ status: 'live', stats: { maturity: 'forming' } })).toBe('active')
    expect(cityAvailability({ status: 'live', stats: { maturity: 'seeding' } })).toBe('founding')
    expect(cityAvailability({ status: 'coming_soon' })).toBe('coming_soon')
    expect(cityAvailability({ status: 'preparing', stats: { maturity: 'seeding' } })).toBe('coming_soon')
  })
})
