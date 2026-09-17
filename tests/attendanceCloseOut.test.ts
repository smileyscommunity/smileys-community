import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue(true), claimOnce: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/audit',     () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/access',    () => ({ canManageEventOps: vi.fn(), isAdmin: (s: any) => s?.role === 'admin' }))
vi.mock('@/lib/city',      () => ({ getCityTz: vi.fn().mockResolvedValue('Europe/Istanbul') }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  event:         { findUnique: vi.fn() },
  eventAttendee: { findMany: vi.fn(), updateMany: vi.fn() },
  rateLimit:     { findMany: vi.fn(async () => []) },
} }))

import { closeOutBlock, noShowCandidates, restToClose, canExcuse } from '@/lib/attendanceCloseOut'
import { POST as closeOut, DELETE as undoCloseOut } from '@/app/api/events/[id]/checkin/close-out/route'
import { GET as roster } from '@/app/api/events/[id]/checkin/route'
import { getSession } from '@/lib/session'
import { canManageEventOps } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

// "Mark the rest as no-show": a no-show is what the host says at the end,
// never inferred from a missing scan. These pin who is marked, when, and
// that undo only touches marks still standing.

const p       = prisma as any
const params  = { params: Promise.resolve({ id: 'e1' }) }
const req     = (body?: unknown) => ({ json: async () => body }) as any
const runners = { hostId: 'h1', cohostIds: ['co1'], clubHostIds: ['ch1'] }

// 18:00–20:00 Istanbul = 15:00–17:00Z
const EVENT = {
  title: 'Sunset Sailing', status: 'published', cancelledAt: null, noShowProcessedAt: null, cityId: 'c1',
  date: '2026-09-13', time: '18:00', endTime: '20:00', hostId: 'h1',
  cohosts: [{ userId: 'co1' }], club: { memberships: [{ userId: 'ch1' }] },
}
const row = (userId: string, role = 'member', over: Record<string, unknown> = {}) => ({
  id: `r-${userId}`, userId, status: 'approved', checkedIn: false, attendance: 'unknown', user: { role }, ...over,
})
const at = (iso: string) => vi.setSystemTime(new Date(iso))

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-09-13T17:30:00Z')
  ;(getSession as any).mockResolvedValue({ id: 'co1', name: 'Co Host', role: 'member' })
  ;(canManageEventOps as any).mockResolvedValue(true)
  p.event.findUnique.mockResolvedValue(EVENT)
  p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
})
afterEach(() => { vi.useRealTimers() })

describe('closeOutBlock', () => {
  const start = new Date('2026-09-13T15:00:00Z')
  // The room settles at the end of the host's review day (attendanceSettlesAt).
  const settles = new Date('2026-09-14T21:00:00Z')
  it('waits for the start', () => {
    expect(closeOutBlock(start, settles, new Date('2026-09-13T14:59:00Z'))).toBe('not_started')
    expect(closeOutBlock(start, settles, new Date('2026-09-13T15:00:00Z'))).toBeNull()
  })
  it('stays open through the review day, then closes', () => {
    expect(closeOutBlock(start, settles, new Date('2026-09-14T20:59:00Z'))).toBeNull()
    expect(closeOutBlock(start, settles, new Date('2026-09-14T21:00:00Z'))).toBe('too_late')
  })
})

describe('noShowCandidates', () => {
  it('marks only unscanned, unmarked guests — never the people running it or staff', () => {
    const rows = [
      row('h1'), row('co1'), row('ch1'), row('mod', 'moderator'), row('adm', 'admin'),
      row('in', 'member', { checkedIn: true, attendance: 'attended' }),
      row('marked', 'member', { attendance: 'no_show' }),
      row('pending', 'member', { status: 'pending' }),
      row('m1'), row('m2'),
    ]
    expect(noShowCandidates(rows, runners).map(r => r.userId)).toEqual(['m1', 'm2'])
  })
  it('a host role attending someone else\'s event is a guest like any member', () => {
    expect(noShowCandidates([row('otherHost', 'host')], runners)).toHaveLength(1)
  })
})

describe('POST /events/[id]/checkin/close-out', () => {
  it('refuses anyone who does not run the event, before reading or writing', async () => {
    ;(canManageEventOps as any).mockResolvedValue(false)
    const res = await closeOut(req(), params)
    expect(res.status).toBe(403)
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })

  it('refuses before the event has started', async () => {
    at('2026-09-13T14:00:00Z')
    const res = await closeOut(req(), params)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('not_started')
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a cancelled event and a settled one', async () => {
    p.event.findUnique.mockResolvedValueOnce({ ...EVENT, status: 'cancelled', cancelledAt: new Date() })
    expect((await closeOut(req(), params)).status).toBe(400)
    p.event.findUnique.mockResolvedValueOnce({ ...EVENT, noShowProcessedAt: new Date() })
    const settled = await closeOut(req(), params)
    expect(settled.status).toBe(409)
    expect((await settled.json()).code).toBe('attendance_settled')
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })

  it('marks the guests only, with the door conditions in the write, and audits it', async () => {
    p.eventAttendee.findMany
      .mockResolvedValueOnce([row('h1'), row('co1'), row('ch1'), row('mod', 'moderator'), row('m1'), row('m2')])
      .mockResolvedValueOnce([{ userId: 'm1' }, { userId: 'm2' }])
    const res = await closeOut(req(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ marked: ['m1', 'm2'] })
    const { where, data } = p.eventAttendee.updateMany.mock.calls[0][0]
    expect(where.id).toEqual({ in: ['r-m1', 'r-m2'] })
    expect(where).toMatchObject({ status: 'approved', checkedIn: false, attendance: 'unknown', event: { noShowProcessedAt: null, cancelledAt: null } })
    expect(data).toEqual({ attendance: 'no_show' })
    expect(writeAudit).toHaveBeenCalledWith('co1', 'Co Host', 'event_no_shows_marked', 'e1', 'event',
      expect.objectContaining({ count: 2, userIds: ['m1', 'm2'] }), expect.any(String))
  })

  it('writes nothing when everyone is accounted for', async () => {
    p.eventAttendee.findMany.mockResolvedValueOnce([row('h1')])
    const res = await closeOut(req(), params)
    expect(await res.json()).toEqual({ marked: [] })
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
    expect(writeAudit).not.toHaveBeenCalled()
  })
})

describe('DELETE /events/[id]/checkin/close-out (undo)', () => {
  it('clears only marks still standing on unscanned rows, and audits those rows', async () => {
    p.eventAttendee.findMany.mockResolvedValueOnce([{ id: 'r-m1', userId: 'm1' }])
    p.eventAttendee.updateMany.mockResolvedValueOnce({ count: 1 })
    const res = await undoCloseOut(req({ userIds: ['m1', 'm2', 42, 'x'.repeat(65)] }), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cleared: 1 })
    expect(p.eventAttendee.findMany.mock.calls[0][0].where)
      .toMatchObject({ eventId: 'e1', userId: { in: ['m1', 'm2'] }, checkedIn: false, attendance: 'no_show' })
    const { where, data } = p.eventAttendee.updateMany.mock.calls[0][0]
    expect(where).toMatchObject({ id: { in: ['r-m1'] }, checkedIn: false, attendance: 'no_show' })
    expect(data).toEqual({ attendance: 'unknown' })
    // The audit names what changed, not what the request claimed.
    expect(writeAudit).toHaveBeenCalledWith('co1', 'Co Host', 'event_no_shows_cleared', 'e1', 'event',
      expect.objectContaining({ count: 1, userIds: ['m1'] }), expect.any(String))
  })

  it('writes nothing when none of the ids is still marked', async () => {
    p.eventAttendee.findMany.mockResolvedValueOnce([])
    expect(await (await undoCloseOut(req({ userIds: ['m1'] }), params)).json()).toEqual({ cleared: 0 })
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it('needs a list, and refuses a settled event or one past its window', async () => {
    expect((await undoCloseOut(req({}), params)).status).toBe(400)
    p.event.findUnique.mockResolvedValueOnce({ ...EVENT, noShowProcessedAt: new Date() })
    expect((await undoCloseOut(req({ userIds: ['m1'] }), params)).status).toBe(409)
    at('2026-09-25T12:00:00Z')
    const late = await undoCloseOut(req({ userIds: ['m1'] }), params)
    expect(late.status).toBe(409)
    expect((await late.json()).code).toBe('too_late')
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })

  it('refuses anyone who does not run the event', async () => {
    ;(canManageEventOps as any).mockResolvedValue(false)
    expect((await undoCloseOut(req({ userIds: ['m1'] }), params)).status).toBe(403)
  })
})

describe('GET /events/[id]/checkin roster', () => {
  it('flags who can never be a no-show, without handing out roles or a co-host the emails', async () => {
    p.event.findUnique.mockResolvedValue({ hostId: 'h1', cohosts: [{ userId: 'co1' }], club: null })
    p.eventAttendee.findMany.mockResolvedValue([
      { ...row('h1'),  user: { id: 'h1',  name: 'Host',  color: '#000', email: 'h@x.test', profilePhoto: null, role: 'host' } },
      { ...row('mod'), user: { id: 'mod', name: 'Mod',   color: '#000', email: 'm@x.test', profilePhoto: null, role: 'moderator' } },
      { ...row('m1'),  user: { id: 'm1',  name: 'Guest', color: '#000', email: 'g@x.test', profilePhoto: null, role: 'member' } },
    ])
    const body = await (await roster(req(), params)).json()
    expect(body.map((r: any) => [r.userId, r.exempt])).toEqual([['h1', true], ['mod', true], ['m1', false]])
    for (const r of body) {
      expect(r.user.role).toBeUndefined()
      expect(r.user.email).toBeUndefined()
    }
  })

  it('the primary host still sees emails', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'h1', name: 'Host', role: 'member' })
    p.event.findUnique.mockResolvedValue({ hostId: 'h1', cohosts: [], club: null })
    p.eventAttendee.findMany.mockResolvedValue([
      { ...row('m1'), user: { id: 'm1', name: 'Guest', color: '#000', email: 'g@x.test', profilePhoto: null, role: 'member' } },
    ])
    const [r] = await (await roster(req(), params)).json()
    expect(r.user.email).toBe('g@x.test')
    expect(r.user.role).toBeUndefined()
  })
})

describe('restToClose (the page\'s count)', () => {
  it('counts unscanned, unmarked, non-exempt rows', () => {
    const rows = [
      { userId: 'a', checkedIn: false, attendance: 'unknown' },
      { userId: 'b', checkedIn: false },
      { userId: 'c', checkedIn: true,  attendance: 'attended' },
      { userId: 'd', checkedIn: false, attendance: 'no_show' },
      { userId: 'e', checkedIn: false, attendance: 'unknown', exempt: true },
      { userId: 'f', checkedIn: false, attendance: 'attended' },
    ]
    expect(restToClose([...rows, { userId: 'g', checkedIn: false, attendance: 'excused' }]).map(r => r.userId)).toEqual(['a', 'b'])
  })
})

describe('canExcuse (the review waiver)', () => {
  it('excuses an unscanned guest, unmarked or marked no-show — never a scan, a runner or staff', () => {
    expect(canExcuse(row('m1'), runners)).toBe(true)
    expect(canExcuse(row('m2', 'member', { attendance: 'no_show' }), runners)).toBe(true)
    expect(canExcuse(row('in', 'member', { checkedIn: true, attendance: 'attended' }), runners)).toBe(false)
    expect(canExcuse(row('x', 'member', { attendance: 'excused' }), runners)).toBe(false)
    expect(canExcuse(row('h1'), runners)).toBe(false)
    expect(canExcuse(row('co1'), runners)).toBe(false)
    expect(canExcuse(row('mod', 'moderator'), runners)).toBe(false)
    expect(canExcuse(row('p', 'member', { status: 'pending' }), runners)).toBe(false)
  })
})
