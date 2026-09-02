import { describe, it, expect } from 'vitest'
import { daysSince, isStalled, stalledSeverity, describeStalled, STALLED_RED_AFTER_DAYS } from '@/lib/cityOps'

// The admin pill for a live city with nothing on its calendar. The rule is
// deliberately blunt — no upcoming event means stalled, however many clubs
// or members it has — because that is the fact nothing in the panel said.

describe('isStalled', () => {
  it('is about the calendar only', () => {
    expect(isStalled({ upcomingEvents: 0 })).toBe(true)
    expect(isStalled({ upcomingEvents: 1 })).toBe(false)
  })
})

describe('stalledSeverity', () => {
  it('gives a founding city a month, then turns red', () => {
    expect(stalledSeverity(0)).toBe('amber')
    expect(stalledSeverity(STALLED_RED_AFTER_DAYS - 1)).toBe('amber')
    expect(stalledSeverity(STALLED_RED_AFTER_DAYS)).toBe('red')
  })
})

describe('daysSince / describeStalled', () => {
  it('counts whole days and never goes negative', () => {
    const now = new Date('2026-09-03T10:00:00Z')
    expect(daysSince(new Date('2026-08-28T12:00:00Z'), now)).toBe(5)
    expect(daysSince(new Date('2026-09-04T00:00:00Z'), now)).toBe(0)
  })
  it('reads as one honest line', () => {
    expect(describeStalled({ name: 'Izmir', members: 3, daysLive: 6 })).toBe('Izmir (3 members · no upcoming event · live 6d)')
    expect(describeStalled({ name: 'Bodrum', members: 1, daysLive: 40 })).toBe('Bodrum (1 member · no upcoming event · live 40d)')
  })
})
