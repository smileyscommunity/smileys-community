import { describe, it, expect, vi, afterEach } from 'vitest'
import { dayInTz, todayInTz, nowInTz, DEFAULT_TZ } from '@/lib/cityTime'

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
