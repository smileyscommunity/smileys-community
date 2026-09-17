import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(), claimOnce: vi.fn() }))
vi.mock('@/lib/city',      () => ({ getCityTz: vi.fn(async () => 'Europe/Istanbul') }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  event:         { findUnique: vi.fn() },
  eventAttendee: { findUnique: vi.fn() },
} }))

import { POST as claim } from '@/app/api/events/[id]/attendance-claim/route'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { rateLimit, claimOnce } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'

// A guest's "I was there" during the morning-after review: only an approved,
// unchecked attendee, only between the end and the settle point, once, and
// it tells the door — it decides nothing.

const p      = prisma as any
const params = { params: Promise.resolve({ id: 'e1' }) }
const req    = {} as any
// Sat 10 Oct 18:00–20:00 Istanbul (15:00–17:00Z); settles Sun 21:00Z.
const EVENT  = {
  title: 'Sunset Sailing', emoji: '⛵', cancelledAt: null, cityId: 'c1',
  date: '2026-10-10', time: '18:00', endTime: '20:00', hostId: 'h1',
  cohosts: [{ userId: 'co1' }], club: { memberships: [{ userId: 'ch1' }] },
}
const at = (iso: string) => vi.setSystemTime(new Date(iso))

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-10-11T08:00:00Z')
  ;(getSession as any).mockResolvedValue({ id: 'g1', name: 'Guest One', role: 'member' })
  ;(rateLimit as any).mockResolvedValue(true)
  ;(claimOnce as any).mockResolvedValue(true)
  ;(createNotification as any).mockResolvedValue(true)
  p.event.findUnique.mockResolvedValue(EVENT)
  p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved', checkedIn: false, attendance: 'unknown' })
})
afterEach(() => { vi.useRealTimers() })

describe('POST /api/events/[id]/attendance-claim', () => {
  it('tells everyone running the door, once, and flags the roster claim', async () => {
    const res = await claim(req, params)
    expect(res.status).toBe(200)
    expect(claimOnce).toHaveBeenCalledWith('attendance-says-came:e1:g1', 7 * 86_400_000)
    const to = (createNotification as any).mock.calls.map((c: any) => [c[0], c[1], c[4]])
    expect(to).toEqual([
      ['h1',  'attendance_claim', '/host/checkin?event=e1'],
      ['co1', 'attendance_claim', '/host/checkin?event=e1'],
      ['ch1', 'attendance_claim', '/host/checkin?event=e1'],
    ])
    expect((createNotification as any).mock.calls[0][2]).toBe('⛵ Guest One says they were at Sunset Sailing')
  })

  it('a second tap tells nobody twice', async () => {
    ;(claimOnce as any).mockResolvedValue(false)
    expect((await (await claim(req, params)).json())).toEqual({ ok: true, already: 'said' })
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('is closed before the end and after the room settles', async () => {
    at('2026-10-10T16:00:00Z')
    expect((await claim(req, params)).status).toBe(409)
    at('2026-10-11T21:00:00Z')
    const late = await claim(req, params)
    expect(late.status).toBe(409)
    expect((await late.json()).code).toBe('attendance_settled')
    expect(claimOnce).not.toHaveBeenCalled()
  })

  it('only an approved attendee who was not checked in; excused and scanned rows are already settled', async () => {
    p.eventAttendee.findUnique.mockResolvedValueOnce(null)
    expect((await claim(req, params)).status).toBe(404)
    p.eventAttendee.findUnique.mockResolvedValueOnce({ status: 'pending', checkedIn: false, attendance: 'unknown' })
    expect((await claim(req, params)).status).toBe(404)
    p.eventAttendee.findUnique.mockResolvedValueOnce({ status: 'approved', checkedIn: true, attendance: 'attended' })
    expect(await (await claim(req, params)).json()).toEqual({ ok: true, already: 'checked_in' })
    p.eventAttendee.findUnique.mockResolvedValueOnce({ status: 'approved', checkedIn: false, attendance: 'excused' })
    expect(await (await claim(req, params)).json()).toEqual({ ok: true, already: 'excused' })
    expect(claimOnce).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('a no-show the host already marked can still say so — that is the point of the day', async () => {
    p.eventAttendee.findUnique.mockResolvedValueOnce({ status: 'approved', checkedIn: false, attendance: 'no_show' })
    expect((await claim(req, params)).status).toBe(200)
    expect(createNotification).toHaveBeenCalledTimes(3)
  })

  it('needs a session and a live event', async () => {
    ;(getSession as any).mockResolvedValueOnce(null)
    expect((await claim(req, params)).status).toBe(403)
    p.event.findUnique.mockResolvedValueOnce({ ...EVENT, cancelledAt: new Date() })
    expect((await claim(req, params)).status).toBe(404)
  })
})
