import { describe, it, expect } from 'vitest'
import {
  isFreeEvent, isNoShow, checkInIsCredible, cardKindFor, windowStart, redCardWindows, restrictionAfterRejectedAppeal,
  evaluateGate, isBlocking, needsAcknowledgement,
  NO_SHOW_CANCELLATION_CUTOFF_HOURS, NO_SHOW_ROLLING_WINDOW_DAYS, RED_CARD_BLOCK_DAYS, RED_CARD_APPEAL_WINDOW_HOURS,
} from '@/lib/noShowPolicy'

// The rules, pinned on their own. The job and the routes only apply these.

const H = 60 * 60 * 1000
const D = 24 * H
const start = new Date('2026-09-12T16:00:00Z')   // 19:00 Istanbul

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
})

describe('rolling window and card colour', () => {
  it('first no-show → yellow, any later one in the window → red', () => {
    expect(cardKindFor(0)).toBe('yellow')
    expect(cardKindFor(1)).toBe('red')
    expect(cardKindFor(3)).toBe('red')
  })
  it('window is exactly the policy length', () => {
    const ref = new Date('2026-09-12T18:00:00Z')
    expect(windowStart(ref).getTime()).toBe(ref.getTime() - NO_SHOW_ROLLING_WINDOW_DAYS * D)
  })
  it('a red card waits out the appeal window, then blocks for the policy length', () => {
    const issued = new Date('2026-09-12T20:00:00Z')
    const w = redCardWindows(issued)
    expect(w.appealDeadlineAt.getTime()).toBe(issued.getTime() + RED_CARD_APPEAL_WINDOW_HOURS * H)
    expect(w.restrictionStartsAt).toEqual(w.appealDeadlineAt)
    expect(w.restrictionEndsAt.getTime()).toBe(w.restrictionStartsAt.getTime() + RED_CARD_BLOCK_DAYS * D)
  })
  it('a rejected appeal never starts the block before the deadline', () => {
    const deadline = new Date('2026-09-14T20:00:00Z')
    const early = restrictionAfterRejectedAppeal(deadline, new Date('2026-09-13T10:00:00Z'))
    expect(early.restrictionStartsAt).toEqual(deadline)
    const late = restrictionAfterRejectedAppeal(deadline, new Date('2026-09-20T10:00:00Z'))
    expect(late.restrictionStartsAt.toISOString()).toBe('2026-09-20T10:00:00.000Z')
    expect(late.restrictionEndsAt.getTime() - late.restrictionStartsAt.getTime()).toBe(RED_CARD_BLOCK_DAYS * D)
  })
})

describe('evaluateGate', () => {
  const now = new Date('2026-09-20T12:00:00Z')
  const base = { eventId: 'e', acknowledgedAt: null, appealDeadlineAt: null, restrictionStartsAt: null, restrictionEndsAt: null }
  const yellow = (o = {}) => ({ ...base, id: 'y', kind: 'yellow', status: 'active', occurredAt: new Date('2026-09-10T20:00:00Z'), ...o })
  const red = (o = {}) => ({
    ...base, id: 'r', kind: 'red', status: 'active', occurredAt: new Date('2026-09-15T20:00:00Z'),
    appealDeadlineAt:    new Date('2026-09-17T22:00:00Z'),
    restrictionStartsAt: new Date('2026-09-17T22:00:00Z'),
    restrictionEndsAt:   new Date('2026-10-17T22:00:00Z'),
    ...o,
  })

  it('no cards → open', () => {
    expect(evaluateGate([], now)).toEqual({ ok: true })
  })
  it('an unacknowledged yellow asks for the confirmation', () => {
    expect(evaluateGate([yellow()], now)).toMatchObject({ ok: false, code: 'yellow_ack_required', cardId: 'y' })
  })
  it('an acknowledged yellow is silent', () => {
    expect(evaluateGate([yellow({ acknowledgedAt: new Date('2026-09-11T00:00:00Z') })], now)).toEqual({ ok: true })
  })
  it('a yellow older than the window no longer asks', () => {
    expect(evaluateGate([yellow({ occurredAt: new Date(now.getTime() - (NO_SHOW_ROLLING_WINDOW_DAYS + 1) * D) })], now)).toEqual({ ok: true })
  })
  it('a red blocks once its restriction has started', () => {
    expect(evaluateGate([red()], now)).toMatchObject({ ok: false, code: 'red_card_blocked', cardId: 'r' })
  })
  it('a red does NOT block before the appeal deadline', () => {
    const before = new Date('2026-09-16T12:00:00Z')
    expect(isBlocking(red(), before)).toBe(false)
    expect(evaluateGate([red()], before)).toEqual({ ok: true })
  })
  it('a red under appeal does not block', () => {
    expect(evaluateGate([red({ status: 'appeal_pending' })], now)).toEqual({ ok: true })
  })
  it('a red whose block has ended is open again', () => {
    expect(evaluateGate([red()], new Date('2026-10-18T00:00:00Z'))).toEqual({ ok: true })
  })
  it('a block wins over a pending confirmation', () => {
    expect(evaluateGate([yellow(), red()], now)).toMatchObject({ code: 'red_card_blocked' })
  })
  it('waived / overturned cards never gate', () => {
    expect(evaluateGate([yellow({ status: 'waived' }), red({ status: 'overturned' })], now)).toEqual({ ok: true })
    expect(needsAcknowledgement(yellow({ status: 'waived' }), now)).toBe(false)
  })
})
