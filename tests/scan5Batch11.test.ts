import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Scan 5, batch 11 — the event edit/delete route (app/api/admin/events/[id]).
//  47. a club host's own event in another city 403'd on every edit/cancel/delete
//  49. the edit forms saved 'Cancelled' (seats released, everyone emailed) unasked
//  50. DELETE hard-deleted events with attendees and paid payments, telling no one

// Edits and invitations are rate-limited and claimed (rate_limits table).
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => true), releaseClaim: vi.fn(async () => {}) }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access', () => ({
  isAdmin:            (s: any) => s?.role === 'admin',
  isAdminOrModerator: (s: any) => s?.role === 'admin' || s?.role === 'moderator',
  isClubHost:         vi.fn(async () => true),
  isClubHostFor:      vi.fn(async () => true),
  hostCityIds:        vi.fn(async () => []),
}))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(() => Promise.resolve()), notifyNewEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/audit',  () => ({ writeAudit: vi.fn(), getDiff: vi.fn(() => null) }))
vi.mock('@/lib/email',  () => ({ sendEventCancelledEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/spotsLeft', () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction:  vi.fn(async (ops: any) => Promise.all(ops)),
    event:         { findUnique: vi.fn(), update: vi.fn(async ({ data }: any) => ({ id: 'e1', totalSpots: 10, ...data })), updateMany: vi.fn(), delete: vi.fn(async () => ({})) },
    eventAttendee: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })), count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
    waitlistEntry: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    review:        { deleteMany: vi.fn(async () => ({ count: 0 })) },
    // Deleting an event also clears the bell rows pointing at it, or they
    // link at a 404 (notifications review, 2026-09-20).
    notification:  { deleteMany: vi.fn(async () => ({ count: 0 })) },
    payment:       { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    paymentLog:    { createMany: vi.fn(async () => ({ count: 0 })) },
    noShowCard:    { findMany: vi.fn(async () => []) },
    // Cancel/postpone check whether the event has started, on its city's clock.
    city:          { findUnique: vi.fn(async () => ({ timezone: 'Europe/Istanbul' })) },
  },
}))

import { PUT, DELETE } from '@/app/api/admin/events/[id]/route'
import { getSession } from '@/lib/session'
import { isClubHost, hostCityIds } from '@/lib/access'
import { prisma } from '@/lib/prisma'

const p = prisma as any
const params = { params: Promise.resolve({ id: 'e1' }) } as never
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

// Lives in Istanbul (c1); the event sits in İzmir (c2).
const clubHost  = { id: 'h1', name: 'Host', role: 'member',    cityId: 'c1' }
const moderator = { id: 'm1', name: 'Mod',  role: 'moderator', cityId: 'c1' }
const admin     = { id: 'a1', name: 'A',    role: 'admin',     cityId: 'c1' }

function existing(over: Record<string, unknown> = {}) {
  return {
    hostId: 'h1', clubId: 'club1', cityId: 'c2', date: '2026-10-01', time: '19:00',
    location: 'x', title: 'T', neighborhood: 'x', price: 0, memberPrice: null,
    totalSpots: 10, emoji: '🎉', isPremium: false, membersOnly: false,
    limitedSpots: false, isFirstTimerFriendly: false, status: 'published', seriesId: null,
    cancelledAt: null, approvalRequired: false,
    ...over,
  }
}
const put = (body: unknown) => PUT({ json: async () => body } as never, params)
const del = () => DELETE({} as never, params)

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(clubHost)
  ;(isClubHost as any).mockResolvedValue(true)
  ;(hostCityIds as any).mockResolvedValue([])
  p.event.findUnique.mockResolvedValue(existing())
  p.eventAttendee.count.mockResolvedValue(0)
  p.payment.count.mockResolvedValue(0)
})

describe('47. a club host manages their own event outside their home city', () => {
  it('PUT: edits and cancels it', async () => {
    expect((await put({ title: 'New' })).status).toBe(200)
    expect((await put({ status: 'cancelled' })).status).toBe(200)
  })
  it('PUT: still refused on someone else\'s event in that city', async () => {
    p.event.findUnique.mockResolvedValue(existing({ hostId: 'other' }))
    expect((await put({ title: 'New' })).status).toBe(403)
    expect(p.event.update).not.toHaveBeenCalled()
  })
  it('PUT: a moderator from another city is still refused', async () => {
    ;(getSession as any).mockResolvedValue(moderator)
    const res = await put({ title: 'New' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Cross-city moderation is admin-only')
    expect(p.event.update).not.toHaveBeenCalled()
  })
  it('PUT: a city host keeps their grant check even on an event they host', async () => {
    ;(isClubHost as any).mockResolvedValue(false)
    ;(hostCityIds as any).mockResolvedValue(['c1'])
    expect((await put({ title: 'New' })).status).toBe(403)
  })
  it('DELETE: deletes their own empty event', async () => {
    expect((await del()).status).toBe(200)
    expect(p.event.delete).toHaveBeenCalledWith({ where: { id: 'e1' } })
  })
  it('DELETE: a moderator from another city is still refused', async () => {
    ;(getSession as any).mockResolvedValue(moderator)
    const res = await del()
    expect(res.status).toBe(403)
    expect(p.event.delete).not.toHaveBeenCalled()
  })
  it('DELETE: a city host outside their grants is still refused', async () => {
    ;(isClubHost as any).mockResolvedValue(false)
    ;(hostCityIds as any).mockResolvedValue(['c1'])
    expect((await del()).status).toBe(403)
    expect(p.event.delete).not.toHaveBeenCalled()
  })
})

describe('50. an event with people or money on it is cancelled, not deleted', () => {
  beforeEach(() => { (getSession as any).mockResolvedValue(admin) })

  it('an active attendee → 409 with the count, nothing erased', async () => {
    p.eventAttendee.count.mockResolvedValue(3)
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/3 attendees going or pending[\s\S]*Cancel it instead/)
    expect(p.eventAttendee.count).toHaveBeenCalledWith({ where: { eventId: 'e1', status: { in: ['approved', 'pending'] } } })
    for (const m of [p.event.delete, p.payment.deleteMany, p.eventAttendee.deleteMany, p.waitlistEntry.deleteMany, p.review.deleteMany, p.$transaction]) {
      expect(m).not.toHaveBeenCalled()
    }
  })
  it('a paid payment → 409, nothing erased', async () => {
    p.payment.count.mockResolvedValue(1)
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('1 paid payment.')
    expect(p.payment.count).toHaveBeenCalledWith({ where: { eventId: 'e1', status: 'paid' } })
    expect(p.payment.deleteMany).not.toHaveBeenCalled()
    expect(p.event.delete).not.toHaveBeenCalled()
  })
  it('an empty event deletes as before', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(p.$transaction).toHaveBeenCalled()
    expect(p.event.delete).toHaveBeenCalledWith({ where: { id: 'e1' } })
  })
})

describe('49. saving an event into Cancelled asks first', () => {
  for (const f of ['app/host/events/[id]/edit/page.tsx', 'app/admin/events/[id]/edit/page.tsx']) {
    it(f, () => {
      const src = read(f)
      const save = src.slice(src.indexOf('async function handleSave()'))
      const gate = save.indexOf("if (form.status === 'cancelled' && loadedStatus !== 'cancelled' &&")
      expect(gate).toBeGreaterThan(-1)
      expect(save.slice(gate, gate + 250)).toMatch(/!\(await confirmToast\('Cancel this event\? Every attendee will be emailed and their spots released\.'[^\n]*\)\)\) return/)
      // Before anything is sent (host: the PUT; admin: the series modal / doSave).
      const firstSend = Math.min(...['fetch(', 'setSeriesModal(true)', 'await doSave('].map(s => save.indexOf(s)).filter(i => i > -1))
      expect(gate).toBeLessThan(firstSend)
      expect(src).toMatch(/setLoadedStatus\(event\.status \?\? 'published'\)/)
    })
  }
  it('both delete handlers surface the server\'s refusal', () => {
    for (const f of ['app/host/events/[id]/edit/page.tsx', 'app/admin/events/[id]/edit/page.tsx']) {
      expect(read(f)).toMatch(/async function handleDelete[\s\S]*?if \(!res\.ok\) \{ await toastApiError\(res, 'Could not delete event'\); return \}/)
    }
    expect(read('app/admin/events/page.tsx')).toContain('if (refusals.length) toast.error(refusals[0])')
  })
})
