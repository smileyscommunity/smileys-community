import { describe, it, expect } from 'vitest'
import {
  isFreeEvent, noShowPolicyApplies, isNoShow, checkInIsCredible, windowStart,
  NO_SHOW_CANCELLATION_CUTOFF_HOURS, NO_SHOW_ROLLING_WINDOW_DAYS,
} from '@/lib/noShowPolicy'

// The rules, pinned on their own. The job and the routes only apply these.

const H = 60 * 60 * 1000
const D = 24 * H
const start = new Date('2026-09-12T16:00:00Z')   // 19:00 Istanbul

describe('noShowPolicyApplies', () => {
  it('applies to free events', () => {
    expect(noShowPolicyApplies({ price: 0 })).toBe(true)
    expect(noShowPolicyApplies({ price: 0, memberPrice: 0, payTo: 'smileys' })).toBe(true)
  })

  it('applies to a priced event paid at the venue on the day — nothing at stake in advance', () => {
    // Kaan's Cibali walk: a 300 TL museum ticket bought at the door. It ran
    // check-in, settled one no-show and issued nothing (2026-09-07).
    expect(noShowPolicyApplies({ price: 300, memberPrice: null, payTo: 'venue', ticketUrl: null, paymentContact: null })).toBe(true)
  })

  it('does not apply when the seat was paid for in advance', () => {
    expect(noShowPolicyApplies({ price: 300, payTo: 'smileys' })).toBe(false)
    expect(noShowPolicyApplies({ price: 300, payTo: 'venue', ticketUrl: 'https://tickets.example/x' })).toBe(false)
    expect(noShowPolicyApplies({ price: 300, payTo: 'venue', paymentContact: 'https://wa.me/905000000000' })).toBe(false)
    // A caller that never loaded the payment fields gets the old, safe answer.
    expect(noShowPolicyApplies({ price: 300 })).toBe(false)
  })
})

describe('isFreeEvent', () => {
  it('is free only when members pay nothing either', () => {
    expect(isFreeEvent({ price: 0 })).toBe(true)
    expect(isFreeEvent({ price: 0, memberPrice: null })).toBe(true)
    expect(isFreeEvent({ price: 0, memberPrice: 0 })).toBe(true)
    expect(isFreeEvent({ price: 250 })).toBe(false)
    expect(isFreeEvent({ price: 250, memberPrice: 0 })).toBe(false)
    expect(isFreeEvent({ price: 0, memberPrice: 100 })).toBe(false)
  })
})

describe('checkInIsCredible', () => {
  it('needs at least one scan and at least half the room', () => {
    expect(checkInIsCredible(0, 10)).toBe(false)
    expect(checkInIsCredible(3, 20)).toBe(false)   // three friends scanned, seventeen "no-shows"
    expect(checkInIsCredible(5, 10)).toBe(true)
    expect(checkInIsCredible(1, 1)).toBe(true)
    expect(checkInIsCredible(1, 2)).toBe(true)
    expect(checkInIsCredible(0, 0)).toBe(false)
  })
})

describe('isNoShow', () => {
  const row = (o: Partial<Parameters<typeof isNoShow>[0]>) =>
    ({ status: 'approved', checkedIn: false, cancelledAt: null, cancelledBy: null, ...o })

  it('confirmed and never checked in → no-show', () => {
    expect(isNoShow(row({}), start)).toBe(true)
  })
  it('checked in → never', () => {
    expect(isNoShow(row({ checkedIn: true }), start)).toBe(false)
  })
  it('pending or removed → never', () => {
    expect(isNoShow(row({ status: 'pending' }), start)).toBe(false)
    expect(isNoShow(row({ status: 'removed', cancelledBy: 'host', cancelledAt: new Date(start.getTime() - H) }), start)).toBe(false)
  })
  it('cancelled before the cutoff → not a no-show', () => {
    const at = new Date(start.getTime() - (NO_SHOW_CANCELLATION_CUTOFF_HOURS + 1) * H)
    expect(isNoShow(row({ status: 'cancelled', cancelledBy: 'member', cancelledAt: at }), start)).toBe(false)
  })
  it('cancelled after the cutoff by the member → no-show', () => {
    const at = new Date(start.getTime() - (NO_SHOW_CANCELLATION_CUTOFF_HOURS - 1) * H)
    expect(isNoShow(row({ status: 'cancelled', cancelledBy: 'member', cancelledAt: at }), start)).toBe(true)
  })
  it('exactly at the cutoff still counts as in time', () => {
    const at = new Date(start.getTime() - NO_SHOW_CANCELLATION_CUTOFF_HOURS * H)
    expect(isNoShow(row({ status: 'cancelled', cancelledBy: 'member', cancelledAt: at }), start)).toBe(false)
  })
  it('checked in and then cancelled → never (the scan proves they came)', () => {
    const at = new Date(start.getTime() + H)   // cancelled mid-event, well past the cutoff
    expect(isNoShow(row({ status: 'cancelled', cancelledBy: 'member', cancelledAt: at, checkedIn: true }), start)).toBe(false)
  })
})

// The v1 card engine and its tests went with v1 (2026-09); the window stays.
describe('rolling window', () => {
  it('is exactly the policy length', () => {
    const ref = new Date('2026-09-12T18:00:00Z')
    expect(windowStart(ref).getTime()).toBe(ref.getTime() - NO_SHOW_ROLLING_WINDOW_DAYS * D)
  })
})

describe('isNoShow — a withdrawn request', () => {
  it('is never a no-show: the seat was never held', () => {
    const start = new Date('2026-09-12T16:00:00Z')
    const late  = new Date('2026-09-12T13:00:00Z')   // well inside the cutoff
    expect(isNoShow({ status: 'cancelled', checkedIn: false, cancelledAt: late, cancelledBy: 'withdrawn' }, start)).toBe(false)
    expect(isNoShow({ status: 'cancelled', checkedIn: false, cancelledAt: late, cancelledBy: 'member' }, start)).toBe(true)
  })
})
