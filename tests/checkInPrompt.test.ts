import { describe, it, expect } from 'vitest'
import { awaitingCheckIn, type CheckInPromptEvent } from '@/lib/checkInPrompt'
import { NO_SHOW_PROCESSING_LOOKBACK_DAYS } from '@/lib/noShowPolicy'

// Which finished events the host is chased about. The guard this mirrors
// (checkInIsCredible) is what kept the sweeper from carding a whole room on
// day one; this list must not chase a host about an event the sweeper would
// never have settled anyway.

const TZ  = 'Europe/Istanbul'
const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-09-12T18:00:00Z')          // 21:00 Istanbul

const event = (over: Partial<CheckInPromptEvent> = {}): CheckInPromptEvent => ({
  id: 'e1', title: 'Coworking', emoji: '💻',
  date: '2026-09-12', time: '12:00', endTime: '14:00',
  status: 'published', price: 0, memberPrice: null,
  noShowProcessedAt: null, checkedInCount: 0,
  _count: { attendees: 8 },
  ...over,
})

describe('awaitingCheckIn', () => {
  it('still chases an event the nightly cron has already archived', () => {
    // The reminders cron flips published → archived the morning after; that
    // is precisely when the host opens the dashboard.
    expect(awaitingCheckIn([event({ status: 'archived' })], TZ, now)).toHaveLength(1)
    expect(awaitingCheckIn([event({ status: 'cancelled' })], TZ, now)).toHaveLength(0)
  })

  it('chases an ended event whose room was never checked in', () => {
    const [p] = awaitingCheckIn([event()], TZ, now)
    expect(p.event.id).toBe('e1')
    expect(p.approved).toBe(8)
    expect(p.checked).toBe(0)
  })

  it('leaves an event that is still running alone', () => {
    expect(awaitingCheckIn([event({ endTime: '23:00' })], TZ, now)).toEqual([])
  })

  it('leaves a credibly checked-in event alone', () => {
    expect(awaitingCheckIn([event({ checkedInCount: 4 })], TZ, now)).toEqual([])
  })

  it('still chases a half-hearted check-in below the ratio', () => {
    expect(awaitingCheckIn([event({ checkedInCount: 3 })], TZ, now)).toHaveLength(1)
  })

  it('ignores paid events — they never yield cards', () => {
    expect(awaitingCheckIn([event({ price: 250 })], TZ, now)).toEqual([])
    expect(awaitingCheckIn([event({ price: 0, memberPrice: 100 })], TZ, now)).toEqual([])
  })

  it('ignores drafts, cancelled events and rooms nobody joined', () => {
    expect(awaitingCheckIn([event({ status: 'draft' })], TZ, now)).toEqual([])
    expect(awaitingCheckIn([event({ status: 'cancelled' })], TZ, now)).toEqual([])
    expect(awaitingCheckIn([event({ _count: { attendees: 0 } })], TZ, now)).toEqual([])
  })

  it('ignores an event the sweeper already settled', () => {
    expect(awaitingCheckIn([event({ noShowProcessedAt: '2026-09-12T17:00:00Z' })], TZ, now)).toEqual([])
  })

  it('stops once the event falls outside the sweeper lookback', () => {
    const old = new Date(now.getTime() + (NO_SHOW_PROCESSING_LOOKBACK_DAYS + 1) * DAY)
    expect(awaitingCheckIn([event()], TZ, old)).toEqual([])
  })

  it('counts the days left down to the sweeper deadline', () => {
    expect(awaitingCheckIn([event()], TZ, now)[0].daysLeft).toBe(NO_SHOW_PROCESSING_LOOKBACK_DAYS)
    const late = new Date(now.getTime() + (NO_SHOW_PROCESSING_LOOKBACK_DAYS - 1) * DAY)
    expect(awaitingCheckIn([event()], TZ, late)[0].daysLeft).toBe(1)
  })

  it('puts the most urgent event first', () => {
    const older = event({ id: 'e0', date: '2026-09-09' })
    const ids = awaitingCheckIn([event(), older], TZ, now).map(p => p.event.id)
    expect(ids).toEqual(['e0', 'e1'])
  })

  it('treats a missing endTime as end of day, so it waits for midnight', () => {
    const noEnd = event({ endTime: null })
    expect(awaitingCheckIn([noEnd], TZ, now)).toEqual([])
    const midnight = new Date('2026-09-12T21:30:00Z')   // 00:30 Istanbul, next day
    expect(awaitingCheckIn([noEnd], TZ, midnight)).toHaveLength(1)
  })
})
