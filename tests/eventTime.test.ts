import { describe, it, expect } from 'vitest'
import { eventEndsAt, eventStartsAt } from '@/lib/eventTime'

// Two routes each carried a private "when did this end" — one still welded
// to +03:00. This pins the shared one: the city's clock decides, a missing
// end reads as 23:59, and an end past midnight lands on the next day.

const IST = 'Europe/Istanbul'   // UTC+3, no DST
const LIS = 'Europe/Lisbon'     // UTC+1 in September (DST)

describe('eventEndsAt', () => {
  it('honours endTime on the event city clock', () => {
    expect(eventEndsAt({ date: '2026-09-12', time: '19:00', endTime: '22:30' }, IST).toISOString())
      .toBe('2026-09-12T19:30:00.000Z')
    expect(eventEndsAt({ date: '2026-09-12', time: '19:00', endTime: '22:30' }, LIS).toISOString())
      .toBe('2026-09-12T21:30:00.000Z')
  })

  it('falls back to 23:59 when endTime is missing or garbled', () => {
    expect(eventEndsAt({ date: '2026-09-12', time: '19:00', endTime: null }, IST).toISOString())
      .toBe('2026-09-12T20:59:00.000Z')
    expect(eventEndsAt({ date: '2026-09-12', time: '19:00', endTime: 'late' }, IST).toISOString())
      .toBe('2026-09-12T20:59:00.000Z')
  })

  it('rolls an end earlier than the start onto the next day', () => {
    // 22:00 – 02:00 is a party, not an event that ended 20 hours before it began.
    expect(eventEndsAt({ date: '2026-09-12', time: '22:00', endTime: '02:00' }, IST).toISOString())
      .toBe('2026-09-12T23:00:00.000Z')
  })

  it('pads a single-digit hour instead of producing Invalid Date', () => {
    expect(eventEndsAt({ date: '2026-09-12', time: '9:00', endTime: '9:45' }, IST).toISOString())
      .toBe('2026-09-12T06:45:00.000Z')
  })
})

describe('eventStartsAt', () => {
  it('reads the start on the city clock and treats a missing time as midnight', () => {
    expect(eventStartsAt({ date: '2026-09-12', time: '19:00' }, IST).toISOString()).toBe('2026-09-12T16:00:00.000Z')
    expect(eventStartsAt({ date: '2026-09-12', time: null }, IST).toISOString()).toBe('2026-09-11T21:00:00.000Z')
  })
})
