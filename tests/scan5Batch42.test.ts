import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Fifth scan, batch 42 — two capacity gaps left by batch 34 (lib/eventCapacity).
//   a. removing a co-host who holds an approved seat makes that seat count
//      again (staff take none): on a full limited event it is refused with
//      409 over_capacity unless allowOverCapacity: true — counted, written and
//      re-derived under the event row lock. Adding a co-host stays allowed.
//   b. "apply to series": every occurrence the cap is copied to is locked
//      (id order) in the same transaction, re-read, checked and written under
//      that lock — not counted outside any lock before the write.
//   c. both edit pages send the co-host removal through withCapacityConfirm.

const read = (p: string) => readFileSync(p, 'utf8')

const h = vi.hoisted(() => {
  // One ordered log of locks, counts and writes, marked with whether each ran
  // inside the interactive transaction.
  const log: string[] = []
  let inTx = false
  const mark = (s: string) => log.push(inTx ? s : `${s} (no tx)`)
  const prisma: any = {
    $transaction: vi.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg)
      inTx = true; log.push('tx:begin')
      try { return await arg(prisma) } finally { inTx = false; log.push('tx:end') }
    }),
    $queryRaw:     vi.fn(async (_s: TemplateStringsArray, eventId: string) => { mark(`lock:${eventId}`); return [] }),
    event:         { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    eventAttendee: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    eventCoHost:   { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    waitlistEntry: { deleteMany: vi.fn() },
    payment:       { findMany: vi.fn() },
    user:          { findUnique: vi.fn() },
    auditLog:      { findMany: vi.fn() },
    noShowCard:    { findMany: vi.fn() },
  }
  return {
    log, mark, prisma,
    getSession:         vi.fn(),
    createNotification: vi.fn(),
    writeAudit:         vi.fn(),
    recompute:          vi.fn(),
    confirmToast:       vi.fn(),
    city: { todayInCity: vi.fn(), getCityTz: vi.fn(), citiesByToday: vi.fn(), resolveCityId: vi.fn() },
  }
})

vi.mock('@/lib/prisma',       () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',      () => ({ getSession: h.getSession }))
vi.mock('@/lib/rateLimit',    () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => true), releaseClaim: vi.fn() }))
vi.mock('@/lib/notify',       () => ({ createNotification: h.createNotification, notifyNewEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/audit',        () => ({ writeAudit: h.writeAudit, getDiff: vi.fn(() => null) }))
vi.mock('@/lib/city',         () => h.city)
vi.mock('@/lib/confirmToast', () => ({ confirmToast: h.confirmToast }))
vi.mock('@/lib/spotsLeft',    () => ({ recomputeSpotsLeft: h.recompute, expectedSpotsLeft: vi.fn(async () => 0) }))
vi.mock('@/lib/access', () => ({
  isAdmin:            (s: any) => s?.role === 'admin',
  isModerator:        (s: any) => s?.role === 'moderator',
  isAdminOrModerator: (s: any) => s?.role === 'admin' || s?.role === 'moderator',
  isClubHost:         vi.fn(async () => false),
  isClubHostFor:      vi.fn(async () => false),
  hostCityIds:        vi.fn(async () => []),
}))
vi.mock('@/lib/email', () => ({ sendEventCancelledEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn(async () => {}) }))
vi.mock('@/lib/rsvpConfirmed', () => ({ backfillSeatPayments: vi.fn(async () => 0), collectsSeatPayment: vi.fn(() => false) }))

import { POST as cohostPOST, DELETE as cohostDELETE } from '@/app/api/admin/events/[id]/cohosts/route'
import { PUT as eventPUT } from '@/app/api/admin/events/[id]/route'

const p = h.prisma
const params = { params: Promise.resolve({ id: 'e1' }) } as any
const req = (body: unknown) => ({ json: async () => body }) as any

const ev = {
  id: 'e1', title: 'Picnic', status: 'published', hostId: 'host', cohosts: [{ userId: 'co1' }], cityId: 'c1',
  date: '2026-09-20', time: '19:00', endTime: null, neighborhood: 'Moda', location: 'Moda', emoji: '🧺', clubId: null,
  totalSpots: 10, spotsLeft: 0, limitedSpots: true, approvalRequired: false,
  price: 0, memberPrice: null, payTo: 'venue', isPremium: false, membersOnly: false, isFirstTimerFriendly: false,
  seriesId: null as string | null, cancelledAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.log.length = 0
  p.event.findUnique.mockResolvedValue(ev)
  p.event.findMany.mockResolvedValue([])
  p.event.update.mockImplementation(async ({ where, data }: any) => { h.mark(`update:${where.id}`); return { ...ev, ...data } })
  p.event.updateMany.mockImplementation(async () => { h.mark('updateMany'); return { count: 1 } })
  p.eventAttendee.findMany.mockResolvedValue([])
  p.eventCoHost.upsert.mockResolvedValue({ id: 'ch1', userId: 'u5' })
  p.eventCoHost.deleteMany.mockImplementation(async () => { h.mark('deleteCohost'); return { count: 1 } })
  p.auditLog.findMany.mockResolvedValue([])
  p.user.findUnique.mockResolvedValue({ name: 'Ada', status: 'approved' })
  h.recompute.mockImplementation(async (id: string) => { h.mark(`recompute:${id}`) })
  h.getSession.mockResolvedValue({ id: 'adm', name: 'Admin', role: 'admin', cityId: 'c1' })
  h.createNotification.mockResolvedValue(true)
  h.city.todayInCity.mockResolvedValue('2026-09-14')
})

// ── a ──────────────────────────────────────────────────────────────────────
describe('a. removing a co-host who holds a seat on a full limited event', () => {
  // `held` = the co-host's own approved seat; `seats` = approved non-staff seats.
  const counts = (held: number, seats: number) =>
    p.eventAttendee.count.mockImplementation(async ({ where }: any) => {
      h.mark(where.userId ? `count:${where.userId}` : 'count:seats')
      return where.userId ? held : seats
    })

  it('answers 409 over_capacity with the counts; the co-host stays, nothing re-derived or audited; counted under the lock', async () => {
    counts(1, 10)
    const res = await cohostDELETE(req({ userId: 'co1' }), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'over_capacity', approved: 10, totalSpots: 10 })
    expect(body.error).toContain('Ada holds a seat')
    expect(p.eventCoHost.deleteMany).not.toHaveBeenCalled()
    expect(h.recompute).not.toHaveBeenCalled()
    expect(h.writeAudit).not.toHaveBeenCalled()
    expect(h.log).toEqual(['tx:begin', 'lock:e1', 'count:seats', 'count:co1', 'tx:end'])
    // the co-host is staff, so the cap count excludes them
    expect(p.eventAttendee.count.mock.calls[0][0].where).toEqual({ eventId: 'e1', status: 'approved', NOT: { userId: { in: ['host', 'co1'] } } })
  })

  it('only a literal allowOverCapacity: true overrides — then removed and re-derived inside the same lock', async () => {
    counts(1, 10)
    expect((await cohostDELETE(req({ userId: 'co1', allowOverCapacity: 'true' }), params)).status).toBe(409)
    h.log.length = 0
    const res = await cohostDELETE(req({ userId: 'co1', allowOverCapacity: true }), params)
    expect(res.status).toBe(200)
    expect(h.log).toEqual(['tx:begin', 'lock:e1', 'count:seats', 'count:co1', 'deleteCohost', 'recompute:e1', 'tx:end'])
    expect(p.eventCoHost.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'e1', userId: 'co1' } })
    expect(h.recompute).toHaveBeenCalledWith('e1', 10, p)
    expect(h.writeAudit).toHaveBeenCalledWith('adm', 'Admin', 'event.cohost_remove', 'co1', 'user', expect.anything(), expect.any(String))
  })

  it('a seat still free, a co-host with no seat, an unlimited event, or someone not a co-host: removed with no question', async () => {
    counts(1, 9)
    expect((await cohostDELETE(req({ userId: 'co1' }), params)).status).toBe(200)

    counts(0, 10)
    expect((await cohostDELETE(req({ userId: 'co1' }), params)).status).toBe(200)

    p.eventAttendee.count.mockClear()
    p.event.findUnique.mockResolvedValue({ ...ev, limitedSpots: false })
    expect((await cohostDELETE(req({ userId: 'co1' }), params)).status).toBe(200)
    expect(p.eventAttendee.count).not.toHaveBeenCalled()

    // not staff: their seat already counts, removing a non-existent co-host row changes nothing
    counts(1, 10)
    p.event.findUnique.mockResolvedValue(ev)
    expect((await cohostDELETE(req({ userId: 'u7' }), params)).status).toBe(200)
    expect(p.eventAttendee.count.mock.calls.some((c: any) => c[0].where.userId)).toBe(false)

    expect(p.eventCoHost.deleteMany).toHaveBeenCalledTimes(4)
    expect(h.recompute).toHaveBeenCalledTimes(4)
  })

  it('adding a co-host (their seat stops counting) stays allowed on a full event and recounts', async () => {
    counts(1, 10)
    expect((await cohostPOST(req({ userId: 'u5' }), params)).status).toBe(200)
    expect(p.eventCoHost.upsert).toHaveBeenCalled()
    expect(h.recompute).toHaveBeenCalledWith('e1', 10)
    expect(p.$queryRaw).not.toHaveBeenCalled()
  })
})

// ── b ──────────────────────────────────────────────────────────────────────
describe('b. apply to series: each occurrence checked and written under its own lock', () => {
  const sib = (id: string, o: Record<string, unknown> = {}) => ({ id, title: 'Picnic', date: id === 'e0' ? '2026-09-13' : '2026-09-27', totalSpots: 10, limitedSpots: true, ...o })
  // What the pre-lock read sees vs what the read inside the transaction sees.
  let outside: any[]
  let inside: any[]
  const seats: Record<string, number> = {}

  beforeEach(() => {
    p.event.findUnique.mockResolvedValue({ ...ev, seriesId: 's1' })
    outside = [sib('e3'), sib('e0')]
    inside  = outside
    Object.assign(seats, { e0: 3, e1: 3, e3: 3 })
    p.event.findMany.mockImplementation(async ({ where }: any) => {
      if (where.id?.in) { h.mark('reread'); return inside.filter(s => where.id.in.includes(s.id)).sort((a, b) => a.id.localeCompare(b.id)) }
      h.mark('findSeries'); return outside
    })
    p.eventAttendee.count.mockImplementation(async ({ where }: any) => { h.mark(`count:${where.eventId}`); return seats[where.eventId] })
  })

  it('locks every occurrence in id order before any count, then checks, writes and re-derives each inside the lock', async () => {
    const res = await eventPUT(req({ totalSpots: 8, applyToSeries: true }), params)
    expect(res.status).toBe(200)
    expect(h.log).toEqual([
      'findSeries (no tx)',
      'tx:begin', 'lock:e0', 'lock:e1', 'lock:e3', 'reread',
      'count:e0', 'count:e3', 'count:e1',
      'update:e1', 'recompute:e1', 'updateMany', 'recompute:e0', 'recompute:e3',
      'tx:end',
    ])
    expect(p.event.updateMany).toHaveBeenCalledWith({ where: { seriesId: 's1', id: { not: 'e1' }, date: { gte: '2026-09-14' } }, data: { totalSpots: 8 } })
    expect(h.recompute).toHaveBeenCalledWith('e0', 8, p)
    expect(h.recompute).toHaveBeenCalledWith('e3', 8, p)
  })

  it('an occurrence under its own seats refuses the whole save with the same message; nothing written', async () => {
    seats.e3 = 9
    const res = await eventPUT(req({ totalSpots: 8, applyToSeries: true }), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'below_approved_seats', approved: 9, totalSpots: 8 })
    expect(body.error).toBe(`"Picnic" on 2026-09-27: 9 members already hold seats — total spots can't go below 9 (asked for 8) unless you confirm going over capacity.`)
    expect(p.event.update).not.toHaveBeenCalled()
    expect(p.event.updateMany).not.toHaveBeenCalled()
    expect(h.recompute).not.toHaveBeenCalled()
    expect(h.log.indexOf('count:e3')).toBeGreaterThan(h.log.indexOf('lock:e3'))
  })

  it("the main event's refusal is unchanged and comes after the occurrences are checked", async () => {
    seats.e1 = 9
    const res = await eventPUT(req({ totalSpots: 8, applyToSeries: true }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(`9 members already hold seats — total spots can't go below 9 (asked for 8) unless you confirm going over capacity.`)
    expect(p.event.update).not.toHaveBeenCalled()
  })

  it("an occurrence's cap is judged as read under the lock, not as read before it", async () => {
    // Before the lock e3 looked already at 8 (no tightening); by the time the
    // lock is held it is 12 with 9 seats — lowering it to 8 must be refused.
    outside = [sib('e3', { totalSpots: 8 })]
    inside  = [sib('e3', { totalSpots: 12 })]
    seats.e3 = 9
    const res = await eventPUT(req({ totalSpots: 8, applyToSeries: true }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('"Picnic" on 2026-09-27')
  })

  it('with the override every occurrence is still locked and re-derived, none refused', async () => {
    Object.assign(seats, { e0: 9, e1: 9, e3: 9 })
    const res = await eventPUT(req({ totalSpots: 8, applyToSeries: true, allowOverCapacity: true }), params)
    expect(res.status).toBe(200)
    expect(h.log.filter(s => s.startsWith('lock:'))).toEqual(['lock:e0', 'lock:e1', 'lock:e3'])
    expect(h.log.filter(s => s.startsWith('count:'))).toEqual(['count:e1'])   // only the main edit's own count; siblings need none
    expect(h.recompute).toHaveBeenCalledWith('e3', 8, p)
  })

  it('a series edit that leaves the cap alone takes no lock and writes the same scope as before', async () => {
    const res = await eventPUT(req({ title: 'Picnic in Moda', applyToSeries: true }), params)
    expect(res.status).toBe(200)
    expect(p.$queryRaw).not.toHaveBeenCalled()
    expect(p.event.findMany).not.toHaveBeenCalled()
    expect(h.log).toEqual(['update:e1 (no tx)', 'updateMany (no tx)'])
    expect(p.event.updateMany).toHaveBeenCalledWith({ where: { seriesId: 's1', id: { not: 'e1' }, date: { gte: '2026-09-14' } }, data: { title: 'Picnic in Moda' } })
  })

  it('without apply-to-series only the event itself is locked', async () => {
    p.eventAttendee.count.mockResolvedValue(3)
    expect((await eventPUT(req({ totalSpots: 8 }), params)).status).toBe(200)
    expect(p.$queryRaw).toHaveBeenCalledTimes(1)
    expect(p.event.findMany).not.toHaveBeenCalled()
    expect(p.event.updateMany).not.toHaveBeenCalled()
  })
})

// ── c ──────────────────────────────────────────────────────────────────────
describe('c. the co-host removal UI goes through the capacity confirm', () => {
  const pages = { admin: read('app/admin/events/[id]/edit/page.tsx'), host: read('app/host/events/[id]/edit/page.tsx') }
  const gatedDelete = /withCapacityConfirm\(allowOverCapacity => fetch\(`\/app\/api\/admin\/events\/\$\{id\}\/cohosts`, \{\n\s+method: 'DELETE',/g

  it('both edit pages send the DELETE through withCapacityConfirm, overriding only on the confirm callback', () => {
    for (const [name, src] of Object.entries(pages)) {
      expect(src.match(gatedDelete)?.length, name).toBe(1)
      expect(src, name).toContain('body: JSON.stringify(allowOverCapacity ? { userId, allowOverCapacity: true } : { userId }),')
      // a "no" resolves null: nothing changed, the chip stays
      const start = src.indexOf('async function removeCohost')
      const fn = src.slice(start, src.indexOf('\n  }\n', start))
      expect(fn, name).toContain('if (!res) return')
      expect(fn, name).toContain("if (!res.ok) { await toastApiError(res, 'Could not remove co-host'); return }")
      expect(fn.indexOf('if (!res.ok)'), name).toBeLessThan(fn.indexOf('setCohosts(prev => prev.filter(c => c.userId !== userId))'))
      // adding a co-host is never capacity-gated
      expect(src.match(/withCapacityConfirm\(allowOverCapacity => fetch\(`\/app\/api\/admin\/events\/\$\{id\}\/cohosts`/g)?.length, name).toBe(1)
    }
  })
})
