import { describe, it, expect, vi, afterEach } from 'vitest'
import { dayInTz, todayInTz, nowInTz, atHourInTz, wallClockInTz, fromWallClockInTz, DEFAULT_TZ } from '@/lib/cityTime'

// These pin the contract the rest of the app already depends on: a calendar day
// belongs to a CITY, not to UTC and not to the viewer's clock.

afterEach(() => vi.useRealTimers())

describe('cityTime', () => {
  it('resolves the calendar day in the target city, not UTC', () => {
    // 22:30 UTC on the 14th is already 01:30 on the 15th in Istanbul.
    const d = new Date('2026-08-14T22:30:00Z')
    expect(dayInTz(d, DEFAULT_TZ)).toBe('2026-08-15')
    expect(dayInTz(d, 'UTC')).toBe('2026-08-14')
  })

  it('gives two cities different days at the same instant', () => {
    const d = new Date('2026-08-15T02:00:00Z')
    expect(dayInTz(d, 'Europe/Istanbul')).toBe('2026-08-15')
    expect(dayInTz(d, 'America/Los_Angeles')).toBe('2026-08-14')
  })

  it('reports midnight as hour 0, never 24 — h23, not hour12:false', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T21:10:00Z'))   // 00:10 in Istanbul
    const n = nowInTz(DEFAULT_TZ)
    expect(n.hour).toBe(0)
    expect(n.minutes).toBe(10)
    expect(n.date).toBe('2026-08-15')
  })

  it('reads the weekday in the city, in the form callers key on', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T09:00:00+03:00'))   // Monday in Istanbul
    expect(nowInTz(DEFAULT_TZ).weekdayShort).toBe('Mon')
  })

  it('exposes minutes since midnight for time-of-day maths', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T14:45:00+03:00'))
    expect(nowInTz(DEFAULT_TZ).minutes).toBe(14 * 60 + 45)
  })

  it('todayInTz shifts by whole days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T12:00:00+03:00'))
    expect(todayInTz(DEFAULT_TZ)).toBe('2026-08-15')
    expect(todayInTz(DEFAULT_TZ, 7)).toBe('2026-08-22')
  })

  it('handles a DST-observing city without hand-built offsets', () => {
    // Athens is UTC+3 in August; the same wall clock in January is UTC+2.
    // Offset arithmetic would get one of these wrong.
    expect(dayInTz(new Date('2026-08-15T21:30:00Z'), 'Europe/Athens')).toBe('2026-08-16')
    expect(dayInTz(new Date('2026-01-15T21:30:00Z'), 'Europe/Athens')).toBe('2026-01-15')
  })
})

// "Tonight at 19:00" is a claim about the CITY's clock. The hangouts composer
// built it as Date.UTC(..., 19 - 3): 19:00 minus a hand-written UTC+3, correct
// for one city and wrong twice a year for any city with DST.
describe('atHourInTz', () => {
  it('lands on 19:00 in the target city, whichever city that is', () => {
    const now = new Date('2026-08-20T09:00:00Z')
    for (const tz of ['Europe/Istanbul', 'Europe/London', 'Asia/Dubai', 'America/New_York']) {
      const at19 = atHourInTz(19, tz, now)
      expect(nowInTz(tz, at19).hour, `19:00 in ${tz}`).toBe(19)
    }
  })

  it('keeps the city\'s own calendar day', () => {
    const now = new Date('2026-08-20T09:00:00Z')
    const tz  = 'Europe/Istanbul'
    expect(nowInTz(tz, atHourInTz(19, tz, now)).date).toBe(nowInTz(tz, now).date)
  })

  it('returns a moment already past when the hour has gone', () => {
    const now = new Date('2026-08-20T20:00:00Z')   // 23:00 in Istanbul
    expect(atHourInTz(19, 'Europe/Istanbul', now).getTime()).toBeLessThan(now.getTime())
  })

  it('handles a zone with a half-hour offset', () => {
    const now = new Date('2026-08-20T09:00:00Z')
    expect(nowInTz('Asia/Kolkata', atHourInTz(19, 'Asia/Kolkata', now)).hour).toBe(19)
  })
})

// A hangout's meet time is the CITY's wall clock: "18:30" means half six where
// the plan is, whatever the creator's laptop says. The old pair formatted via
// the founding city and parsed by tagging '+03:00', which mis-files a plan by
// the offset difference anywhere else and breaks twice a year under DST.
describe('wall clock round trip', () => {
  const CASES = ['Europe/Istanbul', 'Europe/London', 'Asia/Dubai', 'America/New_York', 'Asia/Kolkata']

  it('round-trips a wall-clock value in every city', () => {
    for (const tz of CASES) {
      for (const v of ['2026-08-20T18:30', '2026-01-15T09:05', '2026-12-31T23:45']) {
        expect(wallClockInTz(fromWallClockInTz(v, tz), tz), `${v} in ${tz}`).toBe(v)
      }
    }
  })

  it('resolves the same wall clock to DIFFERENT instants in different cities', () => {
    const a = fromWallClockInTz('2026-08-20T18:30', 'Europe/Istanbul')
    const b = fromWallClockInTz('2026-08-20T18:30', 'Europe/London')
    expect(a.getTime()).not.toBe(b.getTime())
    // Istanbul is ahead, so its 18:30 happens earlier in absolute terms.
    expect(a.getTime()).toBeLessThan(b.getTime())
  })

  it('survives a DST transition, which a fixed +03:00 could not', () => {
    // London: BST (UTC+1) in August, GMT (UTC+0) in January.
    const summer = fromWallClockInTz('2026-08-20T12:00', 'Europe/London')
    const winter = fromWallClockInTz('2026-01-20T12:00', 'Europe/London')
    expect(summer.toISOString()).toContain('T11:00')
    expect(winter.toISOString()).toContain('T12:00')
  })

  it('reads a stored instant back as the city\'s wall clock', () => {
    expect(wallClockInTz(new Date('2026-08-20T15:30:00Z'), 'Europe/Istanbul')).toBe('2026-08-20T18:30')
    expect(wallClockInTz(new Date('2026-08-20T15:30:00Z'), 'Europe/London')).toBe('2026-08-20T16:30')
  })
})
