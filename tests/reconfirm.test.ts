import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notify',     () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/spotOpened', () => ({ announceSpotOpened: vi.fn().mockResolvedValue(1) }))
vi.mock('@/lib/email',      () => ({
  sendReconfirmEmail:    vi.fn().mockResolvedValue(undefined),
  sendSpotReleasedEmail: vi.fn().mockResolvedValue(undefined),
  recordEmailFailure:    vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  city:          { findMany: vi.fn() },
  event:         { findMany: vi.fn() },
  eventAttendee: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  eventCoHost:   { findMany: vi.fn().mockResolvedValue([]) },
  waitlistEntry: { count: vi.fn() },
} }))

import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendReconfirmEmail, sendSpotReleasedEmail } from '@/lib/email'
import { announceSpotOpened } from '@/lib/spotOpened'
import { needsReconfirmation, reconfirmPhase, askEvent, releaseEvent, sweepReconfirm, confirmAttendance } from '@/lib/reconfirm'
import { reconfirmToken, verifyReconfirmToken } from '@/lib/reconfirmToken'
import { RECONFIRM_ASK_HOURS_BEFORE, RECONFIRM_RELEASE_HOURS_BEFORE, RECONFIRM_MIN_LEAD_HOURS } from '@/lib/noShowPolicy'

// The day-before "still coming?" and the seat release behind it. The rules
// are pinned first; then the sweep against a mocked database: who is asked,
// who is released, and that nothing happens when nobody is waiting.

const p = prisma as any
const H = 60 * 60 * 1000
const start = new Date('2026-09-13T16:00:00Z')   // 19:00 Istanbul
const at = (hoursBefore: number) => new Date(start.getTime() - hoursBefore * H)

const EVENT = { id: 'e1', title: 'Coffee', emoji: '☕', hostId: 'host', date: '2026-09-13', time: '19:00', endTime: null,
                price: 0, memberPrice: null, limitedSpots: true, status: 'published', cancelledAt: null, approvalRequired: false }
const row = (id: string, o: any = {}) =>
  ({ id, userId: id, status: 'approved', reconfirmAskedAt: null, reconfirmedAt: null, user: { id, name: id, email: `${id}@x` }, ...o })

beforeEach(() => {
  vi.clearAllMocks()
  p.eventAttendee.update.mockResolvedValue({})
  p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
  p.eventCoHost.findMany.mockResolvedValue([{ userId: 'cohost' }])
})

describe('needsReconfirmation', () => {
  it('free, limited, live events only', () => {
    expect(needsReconfirmation(EVENT)).toBe(true)
    expect(needsReconfirmation({ ...EVENT, price: 100 })).toBe(false)
    expect(needsReconfirmation({ ...EVENT, limitedSpots: false })).toBe(false)
    expect(needsReconfirmation({ ...EVENT, status: 'cancelled', cancelledAt: new Date() })).toBe(false)
    expect(needsReconfirmation({ ...EVENT, status: 'draft' })).toBe(false)
    expect(needsReconfirmation({ ...EVENT, approvalRequired: true })).toBe(false)   // the host vets those seats
    expect(needsReconfirmation({ ...EVENT, time: 'TBA' })).toBe(false)              // would read as midnight
  })
})

describe('reconfirmPhase', () => {
  it('walks early → ask → late → release → started as the start approaches', () => {
    expect(reconfirmPhase(start, at(RECONFIRM_ASK_HOURS_BEFORE + 1))).toBe('early')
    expect(reconfirmPhase(start, at(RECONFIRM_ASK_HOURS_BEFORE))).toBe('ask')
    expect(reconfirmPhase(start, at(RECONFIRM_MIN_LEAD_HOURS + 0.5))).toBe('ask')
    expect(reconfirmPhase(start, at(RECONFIRM_MIN_LEAD_HOURS))).toBe('late')
    expect(reconfirmPhase(start, at(RECONFIRM_RELEASE_HOURS_BEFORE + 0.5))).toBe('late')
    expect(reconfirmPhase(start, at(RECONFIRM_RELEASE_HOURS_BEFORE))).toBe('release')
    expect(reconfirmPhase(start, at(1))).toBe('release')
    expect(reconfirmPhase(start, at(0))).toBe('started')
    expect(reconfirmPhase(start, at(-2))).toBe('started')
  })
})

describe('askEvent', () => {
  it('asks approved, unasked, non-staff attendees once — bell, push, email — and stamps each', async () => {
    p.eventAttendee.findMany.mockResolvedValue([row('a'), row('cohost'), row('host')])
    const asked = await askEvent(EVENT, start, 'Europe/Istanbul', at(24))
    expect(asked).toBe(1)
    expect(p.eventAttendee.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { reconfirmAskedAt: at(24) } })
    expect(createNotification).toHaveBeenCalledWith('a', 'reconfirm_ask', expect.stringContaining('Still coming'), expect.any(String), '/events/e1')
    expect(sendReconfirmEmail).toHaveBeenCalledTimes(1)
    // the query itself excludes already-asked rows — that is the idempotency
    expect(p.eventAttendee.findMany.mock.calls[0][0].where).toMatchObject({ eventId: 'e1', status: 'approved', reconfirmAskedAt: null })
  })
})

describe('releaseEvent', () => {
  it('does nothing when nobody is waiting', async () => {
    p.waitlistEntry.count.mockResolvedValue(0)
    expect(await releaseEvent(EVENT)).toBe(0)
    expect(p.eventAttendee.findMany).not.toHaveBeenCalled()
    expect(announceSpotOpened).not.toHaveBeenCalled()
  })

  it('releases asked-but-unanswered seats as system removals, tells them, and fans the spots out once', async () => {
    p.waitlistEntry.count.mockResolvedValue(2)
    p.eventAttendee.findMany.mockResolvedValue([
      row('silent',  { reconfirmAskedAt: at(24) }),
      row('silent2', { reconfirmAskedAt: at(24) }),
      row('cohost',  { reconfirmAskedAt: at(24) }),
    ])
    expect(await releaseEvent(EVENT)).toBe(2)
    const q = p.eventAttendee.findMany.mock.calls[0][0].where
    expect(q).toMatchObject({ status: 'approved', reconfirmAskedAt: { not: null }, reconfirmedAt: null })
    const first = p.eventAttendee.updateMany.mock.calls[0][0]
    // the write re-checks the answer: a "yes" that landed after the read keeps the seat
    expect(first.where).toEqual({ id: 'silent', status: 'approved', reconfirmAskedAt: { not: null }, reconfirmedAt: null })
    expect(first.data).toMatchObject({ status: 'removed', cancelledBy: 'system' })
    expect(createNotification).toHaveBeenCalledWith('silent', 'reconfirm_released', expect.any(String), expect.any(String), '/events/e1')
    expect(sendSpotReleasedEmail).toHaveBeenCalledTimes(2)
    expect(announceSpotOpened).toHaveBeenCalledTimes(1)
  })

  it('a row already gone (count 0) is skipped without a notification', async () => {
    p.waitlistEntry.count.mockResolvedValue(1)
    p.eventAttendee.findMany.mockResolvedValue([row('gone', { reconfirmAskedAt: at(24) })])
    p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
    expect(await releaseEvent(EVENT)).toBe(0)
    expect(createNotification).not.toHaveBeenCalled()
    expect(announceSpotOpened).not.toHaveBeenCalled()
  })
})

describe('sweepReconfirm', () => {
  beforeEach(() => {
    p.city.findMany.mockResolvedValue([{ id: 'c1', timezone: 'Europe/Istanbul' }])
  })
  it('asks in the ask window and releases inside the cutoff; skips paid/unlimited', async () => {
    p.event.findMany.mockResolvedValue([
      { ...EVENT, id: 'ask',     date: '2026-09-13', time: '19:00' },          // 24h away at now
      { ...EVENT, id: 'release', date: '2026-09-13', time: '02:00' },          // 7h away
      { ...EVENT, id: 'paid',    date: '2026-09-13', time: '19:00', price: 50 },
    ])
    p.eventAttendee.findMany.mockResolvedValue([row('a', { reconfirmAskedAt: at(30) })])
    p.waitlistEntry.count.mockResolvedValue(1)
    const r = await sweepReconfirm(at(24))
    expect(r.errors).toEqual([])
    // 'ask' event: the one row is already asked → findMany filter is what excludes it in real life; here the mock returns it, so asked=1
    expect(r.asked).toBe(1)
    expect(r.released).toBe(1)
  })
  it('one broken event does not stop the others', async () => {
    p.event.findMany.mockResolvedValue([
      { ...EVENT, id: 'bad',  date: '2026-09-13', time: '19:00' },
      { ...EVENT, id: 'good', date: '2026-09-13', time: '19:00' },
    ])
    p.eventAttendee.findMany.mockImplementation(async ({ where }: any) => {
      if (where.eventId === 'bad') throw new Error('boom')
      return [row('a')]
    })
    const r = await sweepReconfirm(at(24))
    expect(r.errors).toEqual(['bad'])
    expect(r.asked).toBe(1)
  })
})

describe('confirmAttendance', () => {
  it('stamps an approved, unanswered row', async () => {
    p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
    expect(await confirmAttendance('u1', 'e1', start)).toBe('ok')
    expect(p.eventAttendee.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', eventId: 'e1', status: 'approved', reconfirmedAt: null },
      data:  { reconfirmedAt: start },
    })
  })
  it('is idempotent, and honest about a seat that was already released', async () => {
    p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
    p.eventAttendee.findUnique.mockResolvedValueOnce({ status: 'approved', cancelledBy: null, reconfirmedAt: start })
    expect(await confirmAttendance('u1', 'e1')).toBe('ok')
    p.eventAttendee.findUnique.mockResolvedValueOnce({ status: 'removed', cancelledBy: 'system', reconfirmedAt: null })
    expect(await confirmAttendance('u1', 'e1')).toBe('released')
    p.eventAttendee.findUnique.mockResolvedValueOnce(null)
    expect(await confirmAttendance('u1', 'e1')).toBe('not_attending')
  })
})

describe('reconfirm token', () => {
  it('round-trips for the same member and event, and for nobody else', () => {
    const t = reconfirmToken('u1', 'e1')
    expect(verifyReconfirmToken('u1', 'e1', t)).toBe(true)
    expect(verifyReconfirmToken('u2', 'e1', t)).toBe(false)
    expect(verifyReconfirmToken('u1', 'e2', t)).toBe(false)
    expect(verifyReconfirmToken('u1', 'e1', t + 'x')).toBe(false)
    expect(verifyReconfirmToken('u1', 'e1', 'ü'.repeat(16))).toBe(false)   // byte length ≠ char length
  })
})
