import { describe, it, expect } from 'vitest'
import { shiftDay, weekRangeOf, weekendRangeOf, discussionLockDay, formatDay } from '@/lib/cityTime'

// The events filter built "This week" / "This weekend" from the browser's
// clock and compared against new Date('YYYY-MM-DD') — UTC midnight — so west
// of UTC every event slid a day earlier, and on a Sunday "this weekend" meant
// NEXT weekend. These are calendar-only: strings in, strings out.

describe('shiftDay', () => {
  it('moves across month and year ends', () => {
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('weekRangeOf', () => {
  it('runs Monday to Sunday around a mid-week day', () => {
    // 2026-09-10 is a Thursday
    expect(weekRangeOf('2026-09-10')).toEqual({ start: '2026-09-07', end: '2026-09-13' })
  })
  it('keeps a Sunday in the week that is ending, not the next one', () => {
    expect(weekRangeOf('2026-09-13')).toEqual({ start: '2026-09-07', end: '2026-09-13' })
  })
  it('starts a new week on Monday', () => {
    expect(weekRangeOf('2026-09-14')).toEqual({ start: '2026-09-14', end: '2026-09-20' })
  })
})

describe('weekendRangeOf', () => {
  it('is the coming Saturday–Sunday during the week', () => {
    expect(weekendRangeOf('2026-09-10')).toEqual({ start: '2026-09-12', end: '2026-09-13' })
  })
  it('on a Sunday still includes today', () => {
    expect(weekendRangeOf('2026-09-13')).toEqual({ start: '2026-09-12', end: '2026-09-13' })
  })
  it('on a Saturday starts today', () => {
    expect(weekendRangeOf('2026-09-12')).toEqual({ start: '2026-09-12', end: '2026-09-13' })
  })
})

describe('discussionLockDay', () => {
  it('is the 15th day after the event (end of day 14)', () => {
    expect(discussionLockDay('2026-09-10')).toBe('2026-09-25')
  })
})

describe('formatDay', () => {
  it('shows the calendar day whatever the process timezone', () => {
    // Used by the command palette and club past-events list, which called
    // new Date('YYYY-MM-DD').toLocaleDateString and showed the day before
    // to anyone west of UTC.
    expect(formatDay('2026-09-12', { day: 'numeric', month: 'short' })).toBe('12 Sept')
  })
})
