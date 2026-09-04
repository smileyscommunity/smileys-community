import { describe, it, expect } from 'vitest'
import { formatDay, weekdayOf, fromWallClockInTz, wallClockInTz, todayInTz, nowInTz, atHourInTz } from '@/lib/cityTime'
import { periodStartDate } from '@/lib/nps'
import { eventStartDate } from '@/lib/eventJsonLd'

// Every Smileys city was in Türkiye, which has not observed daylight saving
// since 2016, so no code path had ever met an offset that moves. The first
// non-Turkish city — Athens, Sofia, New York — brings one. These pin the
// behaviour of lib/cityTime on zones where the clock jumps, on both sides
// of the jump, so the helpers are trusted for what they now have to do
// rather than for what they happened to do at +03:00.

const ATHENS = 'Europe/Athens'     // EET/EEST — +02:00 winter, +03:00 summer
const NYC    = 'America/New_York'  // EST/EDT  — -05:00 winter, -04:00 summer
const IST    = 'Europe/Istanbul'   // +03:00 all year

describe('a calendar day renders the same everywhere', () => {
  it('formatDay needs no zone: the weekday of a date is a fact about the date', () => {
    expect(formatDay('2026-09-09')).toBe('Wed 9 Sept')
    expect(weekdayOf('2026-09-09')).toBe(3)
    // A date on the DST changeover itself, still just a day.
    expect(formatDay('2026-03-29')).toBe('Sun 29 Mar')
  })
})

describe('wall clock ↔ instant on a zone with daylight saving', () => {
  it('19:00 in Athens is 16:00Z in July and 17:00Z in January', () => {
    expect(fromWallClockInTz('2026-07-10T19:00', ATHENS).toISOString()).toBe('2026-07-10T16:00:00.000Z')
    expect(fromWallClockInTz('2026-01-10T19:00', ATHENS).toISOString()).toBe('2026-01-10T17:00:00.000Z')
  })
  it('19:00 in New York is 23:00Z in July and 00:00Z the next day in January', () => {
    expect(fromWallClockInTz('2026-07-04T19:00', NYC).toISOString()).toBe('2026-07-04T23:00:00.000Z')
    expect(fromWallClockInTz('2026-01-04T19:00', NYC).toISOString()).toBe('2026-01-05T00:00:00.000Z')
  })
  it('Istanbul is unchanged: 19:00 is 16:00Z in every month', () => {
    expect(fromWallClockInTz('2026-07-10T19:00', IST).toISOString()).toBe('2026-07-10T16:00:00.000Z')
    expect(fromWallClockInTz('2026-01-10T19:00', IST).toISOString()).toBe('2026-01-10T16:00:00.000Z')
  })
  it('round-trips through the input format on both sides of the change', () => {
    for (const v of ['2026-03-28T12:00', '2026-03-30T12:00', '2026-10-24T12:00', '2026-10-26T12:00']) {
      expect(wallClockInTz(fromWallClockInTz(v, ATHENS), ATHENS)).toBe(v)
    }
  })
  it('a time inside the spring-forward gap lands just after the jump, not on an invented hour', () => {
    // Athens jumps 03:00 → 04:00 on 2026-03-29; 03:30 never happens.
    const d = fromWallClockInTz('2026-03-29T03:30', ATHENS)
    expect(wallClockInTz(d, ATHENS)).toBe('2026-03-29T04:30')
  })
})

describe('what "today" and "tonight" mean per city', () => {
  it('the same instant is a different calendar day in New York and Istanbul', () => {
    const at = new Date('2026-07-05T01:30:00Z')   // 04:30 Istanbul, 21:30 the day before in New York
    expect(nowInTz(IST, at).date).toBe('2026-07-05')
    expect(nowInTz(NYC, at).date).toBe('2026-07-04')
    expect(nowInTz(NYC, at).hour).toBe(21)
  })
  it('atHourInTz reads the city clock, DST included', () => {
    const at = new Date('2026-07-05T12:00:00Z')   // 15:00 in Athens (EEST)
    expect(atHourInTz(19, ATHENS, at).toISOString()).toBe('2026-07-05T16:00:00.000Z')
  })
  it('todayInTz offsets by whole days without touching the zone', () => {
    expect(todayInTz(ATHENS, 0) <= todayInTz(ATHENS, 1)).toBe(true)
  })
})

describe('callers that used to hand-write +03:00', () => {
  it('periodStartDate: Q2 starts at Athens midnight, which is 21:00Z on 31 March', () => {
    expect(periodStartDate('2026-Q2', ATHENS).toISOString()).toBe('2026-03-31T21:00:00.000Z')
    // Q1 is winter in Athens: midnight is 22:00Z.
    expect(periodStartDate('2026-Q1', ATHENS).toISOString()).toBe('2025-12-31T22:00:00.000Z')
    // Default stays the founding city — the cron's behaviour is unchanged.
    expect(periodStartDate('2026-Q2').toISOString()).toBe('2026-03-31T21:00:00.000Z')
  })
  it('JSON-LD startDate carries the city offset for the date, not a fixed one', () => {
    const base = { id: 'e', title: 't', emoji: null }
    expect(eventStartDate({ ...base, date: '2026-07-10', time: '19:00' } as never, ATHENS)).toBe('2026-07-10T19:00:00+03:00')
    expect(eventStartDate({ ...base, date: '2026-01-10', time: '19:00' } as never, ATHENS)).toBe('2026-01-10T19:00:00+02:00')
    expect(eventStartDate({ ...base, date: '2026-07-10', time: '19:00' } as never, NYC)).toBe('2026-07-10T19:00:00-04:00')
  })
})
