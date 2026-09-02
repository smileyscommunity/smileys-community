import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notify', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',  () => ({
  sendYellowCardEmail: vi.fn().mockResolvedValue(undefined),
  sendRedCardEmail:    vi.fn().mockResolvedValue(undefined),
  recordEmailFailure:  vi.fn(),
}))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:  vi.fn(),
  event:         { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  eventAttendee: { findMany: vi.fn(), updateMany: vi.fn() },
  noShowCard:    { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  waitlistEntry: { findMany: vi.fn(), deleteMany: vi.fn() },
  user:          { findMany: vi.fn() },
  city:          { findMany: vi.fn() },
} }))

import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendYellowCardEmail, sendRedCardEmail } from '@/lib/email'
import { settleEvent, sweepNoShows, notifyIssuedCards, activateRedCards, checkRsvpAllowed, recordYellowAcknowledgement, submitAppeal, waiveCard, resolveCard } from '@/lib/noShow'

// The settlement job against a mocked database: which rows become
// no-shows, which get cards of which colour, what makes the job skip, and
// that every pass is idempotent on its stamp.

const p = prisma as any
const NOW = new Date('2026-09-12T23:30:00Z')   // event ended 21:00 UTC (00:00 Istanbul), +2h30

const EVENT = {
  id: 'e1', date: '2026-09-12', time: '19:00', endTime: '23:59', hostId: 'host', price: 0, memberPrice: null,
  status: 'archived', cancelledAt: null, noShowProcessedAt: null,
  city: { timezone: 'Europe/Istanbul' }, cohosts: [{ userId: 'cohost' }],
}
const startsAt = new Date('2026-09-12T16:00:00Z')
const H = 60 * 60 * 1000

const row = (id: string, o: any = {}) =>
  ({ id, userId: id, status: 'approved', checkedIn: false, cancelledAt: null, cancelledBy: null, ...o })

beforeEach(() => {
  vi.clearAllMocks()
  p.$transaction.mockImplementation(async (fn: any) => fn(p))
  p.noShowCard.findUnique.mockResolvedValue(null)
  p.noShowCard.count.mockResolvedValue(0)
  // Settlement prefetch: [existing cards for these rows, prior counting rows in the window]
  p.noShowCard.findMany.mockResolvedValue([])
  p.noShowCard.createMany.mockResolvedValue({ count: 1 })
  p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
  p.event.update.mockResolvedValue({})
})

describe('settleEvent — who is a no-show', () => {
  it('zero check-ins → nobody, and the event is NOT stamped (host may still be scanning)', async () => {
    p.event.findUnique.mockResolvedValue(EVENT)
    p.eventAttendee.findMany.mockResolvedValue([row('a'), row('b')])
    const r = await settleEvent('e1', NOW)
    expect(r.skipped).toBe('no_checkins')
    expect(p.event.update).not.toHaveBeenCalled()
    expect(p.noShowCard.createMany).not.toHaveBeenCalled()
  })

  it('with a check-in: approved+absent and late member cancels are no-shows; checked-in, timely cancels, host removals and staff are not', async () => {
    p.event.findUnique.mockResolvedValue(EVENT)
    p.eventAttendee.findMany.mockResolvedValue([
      row('present', { checkedIn: true }),
      row('absent'),
      row('late',    { status: 'cancelled', cancelledBy: 'member', cancelledAt: new Date(startsAt.getTime() - 3 * H) }),
      row('timely',  { status: 'cancelled', cancelledBy: 'member', cancelledAt: new Date(startsAt.getTime() - 20 * H) }),
      row('kicked',  { status: 'cancelled', cancelledBy: 'host',   cancelledAt: new Date(startsAt.getTime() - 1 * H) }),
      row('cohost'),
    ])
    const r = await settleEvent('e1', NOW)
    expect(r.noShows).toBe(2)
    expect(p.eventAttendee.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['absent', 'late'] } }, data: { attendance: 'no_show' } })
    const { data, skipDuplicates } = p.noShowCard.createMany.mock.calls[0][0]
    expect(data).toHaveLength(2)
    expect(skipDuplicates).toBe(true)
    expect(p.event.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { noShowProcessedAt: NOW } })
  })

  it('too few check-ins for the room → skipped and NOT stamped, so a late-scanning host is picked up next run', async () => {
    p.event.findUnique.mockResolvedValue(EVENT)
    // 1 of 4 non-staff approved scanned — the co-host's row does not count
    // toward the room.
    p.eventAttendee.findMany.mockResolvedValue([
      row('present', { checkedIn: true }), row('a'), row('b'), row('c'), row('cohost', { checkedIn: true }),
    ])
    const r = await settleEvent('e1', NOW)
    expect(r.skipped).toBe('low_checkin')
    expect(p.event.update).not.toHaveBeenCalled()
    expect(p.noShowCard.createMany).not.toHaveBeenCalled()
  })

  it('too early (less than the delay after the end) → skipped, nothing written', async () => {
    p.event.findUnique.mockResolvedValue(EVENT)
    const r = await settleEvent('e1', new Date('2026-09-12T21:30:00Z'))
    expect(r.skipped).toBe('too_early')
    expect(p.eventAttendee.findMany).not.toHaveBeenCalled()
  })

  it('already stamped → skipped: a second run creates nothing', async () => {
    p.event.findUnique.mockResolvedValue({ ...EVENT, noShowProcessedAt: new Date() })
    const r = await settleEvent('e1', NOW)
    expect(r.skipped).toBe('already_processed')
    expect(p.noShowCard.createMany).not.toHaveBeenCalled()
  })

  it('cancelled event → skipped', async () => {
    p.event.findUnique.mockResolvedValue({ ...EVENT, status: 'cancelled', cancelledAt: new Date() })
    expect((await settleEvent('e1', NOW)).skipped).toBe('not_live')
  })

  it('paid event: no-shows are recorded but NO cards are issued', async () => {
    p.event.findUnique.mockResolvedValue({ ...EVENT, price: 300 })
    p.eventAttendee.findMany.mockResolvedValue([row('present', { checkedIn: true }), row('absent')])
    const r = await settleEvent('e1', NOW)
    expect(r.noShows).toBe(1)
    expect(p.eventAttendee.updateMany).toHaveBeenCalled()
    expect(p.noShowCard.createMany).not.toHaveBeenCalled()
    expect(p.noShowCard.findMany).not.toHaveBeenCalled()   // no prefetch either — paid events never look at cards
    expect(r.yellow + r.red).toBe(0)
  })
})

describe('settleEvent — card colour from the rolling window', () => {
  beforeEach(() => {
    p.event.findUnique.mockResolvedValue(EVENT)
    p.eventAttendee.findMany.mockResolvedValue([row('present', { checkedIn: true }), row('absent')])
  })

  it('first no-show → yellow, no restriction dates', async () => {
    p.noShowCard.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const r = await settleEvent('e1', NOW)
    expect(r.yellow).toBe(1); expect(r.red).toBe(0)
    const [card] = p.noShowCard.createMany.mock.calls[0][0].data
    expect(card).toMatchObject({ kind: 'yellow', userId: 'absent', attendeeId: 'absent', eventId: 'e1' })
    expect(card.restrictionStartsAt).toBeUndefined()
  })

  it('a prior no-show in the window → red, with appeal deadline and block dates', async () => {
    p.noShowCard.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ userId: 'absent' }])
    const r = await settleEvent('e1', NOW)
    expect(r.red).toBe(1)
    const [card] = p.noShowCard.createMany.mock.calls[0][0].data
    expect(card.kind).toBe('red')
    expect(card.appealDeadlineAt.getTime()).toBe(NOW.getTime() + 48 * H)
    expect(card.restrictionEndsAt.getTime()).toBe(NOW.getTime() + 48 * H + 30 * 24 * H)
    // The window query is anchored on the event's end and excludes this
    // event's own rows — it is what makes a 91-day-old no-show not count,
    // across every city, and what stops the same evening counting twice.
    const where = p.noShowCard.findMany.mock.calls[1][0].where
    expect(where.userId).toEqual({ in: ['absent'] })
    expect(where.attendeeId).toEqual({ notIn: ['absent'] })
    expect(where.occurredAt.lte.getTime() - where.occurredAt.gte.getTime()).toBe(90 * 24 * H)
    expect(where.status.in).toEqual(expect.arrayContaining(['active', 'expired']))
    expect(where.status.in).not.toContain('waived')
  })

  it('a card that already exists for the row is left alone (idempotent)', async () => {
    p.noShowCard.findMany.mockResolvedValueOnce([{ attendeeId: 'absent' }]).mockResolvedValueOnce([])
    const r = await settleEvent('e1', NOW)
    expect(p.noShowCard.createMany).not.toHaveBeenCalled()
    expect(r.yellow + r.red).toBe(0)
  })
})

describe('notifyIssuedCards — one email, one bell, then stamped', () => {
  it('sends per card and stamps notifiedAt', async () => {
    p.noShowCard.findMany.mockResolvedValue([
      { id: 'y', kind: 'yellow', userId: 'u1', user: { id: 'u1', name: 'A B', email: 'a@x' }, event: { title: 'T', emoji: '🎉' } },
      { id: 'r', kind: 'red', userId: 'u2', user: { id: 'u2', name: 'C', email: 'c@x' }, event: { title: 'T', emoji: '🎉' },
        appealDeadlineAt: new Date(), restrictionStartsAt: new Date(), restrictionEndsAt: new Date() },
    ])
    p.noShowCard.update.mockResolvedValue({})
    expect(await notifyIssuedCards()).toBe(2)
    expect(sendYellowCardEmail).toHaveBeenCalledTimes(1)
    expect(sendRedCardEmail).toHaveBeenCalledTimes(1)
    expect(createNotification).toHaveBeenCalledTimes(2)
    expect(p.noShowCard.update).toHaveBeenCalledWith({ where: { id: 'y' }, data: { notifiedAt: expect.any(Date) } })
    expect(p.noShowCard.update).toHaveBeenCalledWith({ where: { id: 'r' }, data: { notifiedAt: expect.any(Date) } })
  })
  it('nothing pending → nothing sent', async () => {
    p.noShowCard.findMany.mockResolvedValue([])
    expect(await notifyIssuedCards()).toBe(0)
    expect(createNotification).not.toHaveBeenCalled()
  })
})

describe('activateRedCards — block starts, waitlists cleared, once', () => {
  it('removes the member from every waitlist and stamps the card', async () => {
    p.noShowCard.findMany.mockResolvedValue([{ id: 'r', userId: 'u1', restrictionEndsAt: new Date('2026-10-20T00:00:00Z') }])
    p.waitlistEntry.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }])
    p.waitlistEntry.deleteMany.mockResolvedValue({ count: 2 })
    p.noShowCard.update.mockResolvedValue({})
    expect(await activateRedCards(NOW)).toBe(1)
    expect(p.waitlistEntry.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['w1', 'w2'] } } })
    expect(p.noShowCard.update).toHaveBeenCalledWith({ where: { id: 'r' }, data: { restrictionNotifiedAt: NOW } })
    const query = p.noShowCard.findMany.mock.calls[0][0].where
    expect(query).toMatchObject({ kind: 'red', status: 'active', restrictionNotifiedAt: null })
  })
})

describe('checkRsvpAllowed — the yellow confirmation', () => {
  const yellow = { id: 'y', kind: 'yellow', status: 'active', eventId: 'e0', occurredAt: new Date(NOW.getTime() - 5 * 24 * H),
                   acknowledgedAt: null, appealDeadlineAt: null, restrictionStartsAt: null, restrictionEndsAt: null }
  it('without the confirmation the gate refuses', async () => {
    p.noShowCard.findMany.mockResolvedValue([yellow])
    expect(await checkRsvpAllowed('u1', { eventId: 'e1', acknowledge: false }, NOW)).toMatchObject({ ok: false, code: 'yellow_ack_required' })
    expect(p.noShowCard.updateMany).not.toHaveBeenCalled()
  })
  it('with it, the gate opens but nothing is written yet — the route records it after the join lands', async () => {
    p.noShowCard.findMany.mockResolvedValue([yellow])
    expect(await checkRsvpAllowed('u1', { eventId: 'e1', acknowledge: true }, NOW)).toEqual({ ok: true, pendingAck: true })
    expect(p.noShowCard.updateMany).not.toHaveBeenCalled()
  })
  it('recording the acknowledgement stamps every outstanding yellow', async () => {
    p.noShowCard.updateMany.mockResolvedValue({ count: 1 })
    await recordYellowAcknowledgement('u1', 'e1', NOW)
    expect(p.noShowCard.updateMany.mock.calls[0][0]).toMatchObject({
      where: { userId: 'u1', kind: 'yellow', status: 'active', acknowledgedAt: null },
      data:  { acknowledgedAt: NOW, acknowledgedEventId: 'e1' },
    })
  })
  it('a confirmation does not get past a red block', async () => {
    const red = { ...yellow, id: 'r', kind: 'red', restrictionStartsAt: new Date(NOW.getTime() - H), restrictionEndsAt: new Date(NOW.getTime() + H),
                  appealDeadlineAt: new Date(NOW.getTime() - H) }
    p.noShowCard.findMany.mockResolvedValue([red])
    expect(await checkRsvpAllowed('u1', { eventId: 'e1', acknowledge: true }, NOW)).toMatchObject({ code: 'red_card_blocked' })
    expect(p.noShowCard.updateMany).not.toHaveBeenCalled()
  })
})

describe('submitAppeal — inside the window, once', () => {
  const red = { id: 'r', userId: 'u1', kind: 'red', status: 'active', appealStatus: null,
                appealDeadlineAt: new Date(NOW.getTime() + 10 * H), event: { title: 'T' }, user: { name: 'A', cityId: 'c' } }
  beforeEach(() => { p.noShowCard.update.mockResolvedValue({}); p.user.findMany.mockResolvedValue([{ id: 'admin' }]) })

  it('stores the appeal, parks the card, pings admins', async () => {
    p.noShowCard.findFirst.mockResolvedValue(red)
    expect(await submitAppeal('r', 'u1', 'I was there, the scan failed', NOW)).toBe('ok')
    expect(p.noShowCard.update).toHaveBeenCalledWith({
      where: { id: 'r' },
      data:  { appealNote: 'I was there, the scan failed', appealedAt: NOW, appealStatus: 'pending', status: 'appeal_pending' },
    })
    expect(createNotification).toHaveBeenCalledWith('admin', 'no_show_appeal', expect.any(String), expect.any(String), '/admin/no-shows')
  })
  it('after the deadline → window_closed', async () => {
    p.noShowCard.findFirst.mockResolvedValue({ ...red, appealDeadlineAt: new Date(NOW.getTime() - H) })
    expect(await submitAppeal('r', 'u1', 'late but honest', NOW)).toBe('window_closed')
    expect(p.noShowCard.update).not.toHaveBeenCalled()
  })
  it('twice → already_appealed; yellow → not_appealable; someone else\'s → not_found', async () => {
    p.noShowCard.findFirst.mockResolvedValueOnce({ ...red, appealStatus: 'pending' })
    expect(await submitAppeal('r', 'u1', 'again', NOW)).toBe('already_appealed')
    p.noShowCard.findFirst.mockResolvedValueOnce({ ...red, kind: 'yellow', appealDeadlineAt: null })
    expect(await submitAppeal('r', 'u1', 'a yellow one', NOW)).toBe('not_appealable')
    p.noShowCard.findFirst.mockResolvedValueOnce(null)   // findFirst is scoped to userId
    expect(await submitAppeal('r', 'u2', 'not mine', NOW)).toBe('not_found')
  })
})

describe('waiveCard — closes the card, keeps the trail, unwinds a dependent red', () => {
  it('marks the card waived with who/when/why and notifies the member', async () => {
    p.noShowCard.findUnique.mockResolvedValue({ id: 'y', userId: 'u1', kind: 'yellow', status: 'active', eventId: 'e1',
      occurredAt: new Date('2026-09-01T20:00:00Z'), event: { title: 'T', emoji: '🎉' } })
    p.noShowCard.update.mockResolvedValue({})
    p.noShowCard.findMany.mockResolvedValue([])
    expect(await waiveCard({ cardId: 'y', actor: { id: 'h', name: 'Host' }, reason: 'scanner died' })).toBe('ok')
    expect(p.noShowCard.update).toHaveBeenCalledWith({
      where: { id: 'y' },
      data:  { status: 'waived', waivedAt: expect.any(Date), waivedById: 'h', waiveReason: 'scanner died' },
    })
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()   // attendance record untouched
    expect(createNotification).toHaveBeenCalledWith('u1', 'no_show_waived', expect.any(String), expect.any(String), '/no-show')
  })

  it('a later red that only stood on the waived card becomes a yellow', async () => {
    p.noShowCard.findUnique.mockResolvedValue({ id: 'y', userId: 'u1', kind: 'yellow', status: 'active', eventId: 'e1',
      occurredAt: new Date('2026-09-01T20:00:00Z'), event: { title: 'First', emoji: '🎉' } })
    p.noShowCard.update.mockResolvedValue({})
    p.noShowCard.findMany.mockResolvedValue([{ id: 'r', userId: 'u1', kind: 'red', status: 'active', attendeeId: 'a2',
      occurredAt: new Date('2026-09-10T20:00:00Z'), appealStatus: null, resolvedAt: null, resolutionNote: null, event: { title: 'Second' } }])
    p.noShowCard.count.mockResolvedValue(0)   // once the waived one no longer counts
    await waiveCard({ cardId: 'y', actor: { id: 'h', name: 'Host' }, reason: 'my mistake' })
    const downgrade = p.noShowCard.update.mock.calls.find((c: any) => c[0].where.id === 'r')[0]
    expect(downgrade.data).toMatchObject({ kind: 'yellow', status: 'active', restrictionStartsAt: null, restrictionEndsAt: null })
    expect(createNotification).toHaveBeenCalledWith('u1', 'no_show_downgraded', expect.any(String), expect.any(String), '/no-show')
  })

  it('closed cards cannot be waived again', async () => {
    p.noShowCard.findUnique.mockResolvedValue({ id: 'y', status: 'waived', event: {} })
    expect(await waiveCard({ cardId: 'y', actor: { id: 'h', name: 'Host' }, reason: 'x' })).toBe('not_waivable')
  })
})

describe('sweepNoShows — one bad event does not stop the hour', () => {
  it('settles the rest and still runs notify / activate / expire', async () => {
    p.city.findMany.mockResolvedValue([{ id: 'c1', timezone: 'Europe/Istanbul' }])
    p.event.findMany.mockResolvedValue([
      { id: 'bad',  date: '2026-09-12', time: '19:00', endTime: '20:00' },
      { id: 'good', date: '2026-09-12', time: '19:00', endTime: '20:00' },
    ])
    p.event.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'bad') throw new Error('db hiccup')
      return { ...EVENT, id: 'good', endTime: '20:00' }
    })
    p.eventAttendee.findMany.mockResolvedValue([row('present', { checkedIn: true }), row('absent')])
    p.noShowCard.findMany.mockResolvedValue([])
    p.noShowCard.updateMany.mockResolvedValue({ count: 0 })
    const r = await sweepNoShows(new Date('2026-09-13T06:00:00Z'))
    expect(r.errors).toEqual(['bad'])
    expect(r.settled).toBe(1)
    expect(r.noShows).toBe(1)
    // the later passes ran (their findMany / updateMany were consulted)
    expect(p.noShowCard.updateMany).toHaveBeenCalled()
  })
})

describe('resolveCard — accepting an appeal or overturning also unwinds a dependent red', () => {
  it('overturn → later red built on it becomes yellow', async () => {
    p.noShowCard.findUnique.mockResolvedValue({ id: 'y', userId: 'u1', kind: 'yellow', status: 'active', eventId: 'e1',
      appealStatus: null, occurredAt: new Date('2026-09-01T20:00:00Z'), event: { title: 'First' } })
    p.noShowCard.update.mockResolvedValue({})
    p.noShowCard.findMany.mockResolvedValue([{ id: 'r', userId: 'u1', kind: 'red', status: 'active', attendeeId: 'a2',
      occurredAt: new Date('2026-09-01T20:00:00Z'), appealStatus: null, resolvedAt: null, resolutionNote: null, event: { title: 'Same evening' } }])
    p.noShowCard.count.mockResolvedValue(0)
    expect(await resolveCard({ cardId: 'y', action: 'overturn', actor: { id: 'adm', name: 'Admin' }, note: 'host error' })).toBe('ok')
    // same-instant red is found (gte + id exclusion), not skipped
    const q = p.noShowCard.findMany.mock.calls[0][0].where
    expect(q.occurredAt).toEqual({ gte: new Date('2026-09-01T20:00:00Z') })
    expect(q.id).toEqual({ not: 'y' })
    const downgrade = p.noShowCard.update.mock.calls.find((c: any) => c[0].where.id === 'r')[0]
    expect(downgrade.data).toMatchObject({ kind: 'yellow', restrictionStartsAt: null })
    expect(createNotification).toHaveBeenCalledWith('u1', 'no_show_downgraded', expect.any(String), expect.any(String), '/no-show')
  })
})
