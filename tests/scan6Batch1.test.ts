import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Sixth scan, batch 1 — archiving, drafting or postponing a CANCELLED event
// counted as un-cancelling it:
//   a. PUT: only a move into published restores seats and clears cancelledAt;
//      archived / draft / postponed keep the stamp, reseat nobody, notify
//      nobody, re-open no payments
//   b. PATCH: flagged / unpublished / pending likewise; published restores
//   c. a host can't go cancelled → draft → published past the moderator
//   d. the survey sweep and the reminders review / connection asks skip an
//      archived cancelled event
// lib/eventRestore runs for real over the mocked prisma, so "no notices"
// means the restore itself never ran, not just that a spy wasn't called.

const h = vi.hoisted(() => {
  const prisma = {
    $transaction:           vi.fn(),
    city:                   { findMany: vi.fn(), findUnique: vi.fn() },
    event:                  { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    eventAttendee:          { findMany: vi.fn(), updateMany: vi.fn() },
    eventCoHost:            { findMany: vi.fn() },
    waitlistEntry:          { deleteMany: vi.fn(), upsert: vi.fn() },
    listing:                { updateMany: vi.fn(), findMany: vi.fn() },
    visitorAnnouncement:    { updateMany: vi.fn() },
    notification:           { findMany: vi.fn() },
    notificationPreference: { findMany: vi.fn() },
  }
  return {
    prisma,
    getSession:          vi.fn(),
    isClubHost:          vi.fn(),
    hostCityIds:         vi.fn(),
    createNotification:  vi.fn(),
    notifyNewEvent:      vi.fn(),
    writeAudit:          vi.fn(),
    backfillSeatPayments: vi.fn(),
    wasStaffPublished:   vi.fn(),
    recompute:           vi.fn(),
    claimOnce:           vi.fn(),
    releaseClaim:        vi.fn(),
    citiesByToday:       vi.fn(),
    email: {
      sendEventCancelledEmail: vi.fn(),
      sendReviewRequestEmail:  vi.fn(),
      sendListingExpiryEmail:  vi.fn(),
      recordEmailFailure:      vi.fn(),
    },
  }
})

vi.mock('@/lib/prisma',  () => ({ prisma: h.prisma }))
vi.mock('@/lib/session', () => ({ getSession: h.getSession }))
vi.mock('@/lib/access', () => ({
  isAdmin:            (s: any) => s?.role === 'admin',
  isAdminOrModerator: (s: any) => s?.role === 'admin' || s?.role === 'moderator',
  isClubHost:         h.isClubHost,
  isClubHostFor:      vi.fn(async () => true),
  hostCityIds:        h.hostCityIds,
}))
vi.mock('@/lib/notify',               () => ({ createNotification: h.createNotification, notifyNewEvent: h.notifyNewEvent }))
vi.mock('@/lib/audit',                () => ({ writeAudit: h.writeAudit, getDiff: vi.fn(() => null) }))
vi.mock('@/lib/email',                () => h.email)
vi.mock('@/lib/spotsLeft',            () => ({ recomputeSpotsLeft: h.recompute }))
vi.mock('@/lib/rsvpConfirmed',        () => ({ backfillSeatPayments: h.backfillSeatPayments, collectsSeatPayment: vi.fn(() => false) }))
vi.mock('@/lib/eventPublishHistory',  () => ({ wasStaffPublished: h.wasStaffPublished }))
vi.mock('@/lib/seriesOwnership',      () => ({ checkSeriesId: vi.fn(async () => ({ ok: true })), seriesScopeFor: vi.fn(() => ({})) }))
vi.mock('@/lib/eventCapacity', () => ({
  lockEventRow: vi.fn(), seatState: vi.fn(), shrinkVerdict: vi.fn(() => ({ ok: true })),
  belowApprovedBody: vi.fn(), wantsOverCapacity: vi.fn(() => false),
}))
vi.mock('@/lib/city',       () => ({ citiesByToday: h.citiesByToday, todayInCity: vi.fn(async () => '2026-09-15'), getCityTz: vi.fn(async () => 'Europe/Istanbul') }))
vi.mock('@/lib/rateLimit',  () => ({ claimOnce: h.claimOnce, releaseClaim: h.releaseClaim, rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/cronHealth', () => ({ recordCronRun: vi.fn() }))

import { readFileSync } from 'fs'
import { PUT, PATCH } from '@/app/api/admin/events/[id]/route'
import { POST as surveysSweep } from '@/app/api/cron/sweep-event-surveys/route'
import { GET as remindersGET } from '@/app/api/admin/cron/reminders/route'

const p = h.prisma as any
const read = (f: string) => readFileSync(f, 'utf-8')
const params = { params: Promise.resolve({ id: 'e1' }) } as never
const req = (body: unknown) => ({ json: async () => body }) as never
const cronReq = () => new Request('http://x/api', { headers: { 'x-cron-secret': 'sek', authorization: 'Bearer sek' } }) as any

const admin = { id: 'a1', name: 'Admin', role: 'admin', cityId: 'c1' }
const mod   = { id: 'm1', name: 'Mod',   role: 'moderator', cityId: 'c1' }
const host  = { id: 'h1', name: 'Host',  role: 'member', cityId: 'c1' }
const stamp = new Date('2026-09-10T12:00:00.000Z')

const existing = (o: Record<string, unknown> = {}) => ({
  hostId: 'h1', clubId: 'club1', cityId: 'c1', date: '2026-09-20', time: '19:00', endTime: null,
  location: 'x', title: 'Picnic', neighborhood: 'x', price: 0, memberPrice: null, payTo: 'venue',
  totalSpots: 10, emoji: '🧺', isPremium: false, membersOnly: false, limitedSpots: false,
  isFirstTimerFriendly: false, status: 'cancelled', seriesId: null, cancelledAt: stamp, approvalRequired: false,
  ...o,
})
// Two members the cancel released — what a restore would find and reseat.
const released = [{ id: 'r1', userId: 'u1' }, { id: 'r2', userId: 'u2' }]

const updateData = () => p.event.update.mock.calls.at(-1)[0].data
const backOnNotices = () => h.createNotification.mock.calls.filter((c: any[]) => c[2] === 'Event is back on 🎉')

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'sek'
  h.getSession.mockResolvedValue(admin)
  h.isClubHost.mockResolvedValue(false)
  h.hostCityIds.mockResolvedValue([])
  h.createNotification.mockResolvedValue(true)
  h.notifyNewEvent.mockResolvedValue(undefined)
  h.backfillSeatPayments.mockResolvedValue(undefined)
  h.wasStaffPublished.mockResolvedValue(true)
  h.recompute.mockResolvedValue(undefined)
  h.claimOnce.mockResolvedValue(true)
  h.releaseClaim.mockResolvedValue(undefined)
  for (const f of Object.values(h.email)) f.mockResolvedValue(undefined)
  p.$transaction.mockImplementation(async (arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(p))
  p.event.update.mockImplementation(async ({ data }: any) => ({ id: 'e1', ...existing(), ...data }))
  p.eventAttendee.findMany.mockResolvedValue(released)
  p.eventAttendee.updateMany.mockResolvedValue({ count: 2 })
  p.waitlistEntry.deleteMany.mockResolvedValue({ count: 0 })
})
afterEach(() => vi.useRealTimers())

function expectNothingRestored() {
  expect(updateData()).not.toHaveProperty('cancelledAt')
  expect(p.eventAttendee.findMany).not.toHaveBeenCalled()
  expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  expect(h.backfillSeatPayments).not.toHaveBeenCalled()
  expect(h.createNotification).not.toHaveBeenCalled()
  expect(h.notifyNewEvent).not.toHaveBeenCalled()
  expect(h.writeAudit.mock.calls.some((c: any[]) => c[2] === 'event.restore')).toBe(false)
}

// ── a ──────────────────────────────────────────────────────────────────────
describe('a. PUT: parking a cancelled event is not a restore', () => {
  it.each(['archived', 'draft', 'postponed'])('staff cancelled → %s keeps cancelledAt, seats, payments; sends nothing', async (status) => {
    p.event.findUnique.mockResolvedValue(existing())
    const res = await PUT(req({ status }), params)
    expect(res.status).toBe(200)
    expect(updateData().status).toBe(status)
    expectNothingRestored()
  })

  it('a host cannot archive their event at all (the standing sweep reads archived as held)', async () => {
    h.getSession.mockResolvedValue(host)
    h.isClubHost.mockResolvedValue(true)
    p.event.findUnique.mockResolvedValue(existing())
    const res = await PUT(req({ status: 'archived' }), params)
    expect(res.status).toBe(403)
    expect(p.event.update).not.toHaveBeenCalled()
  })

  it('staff cancelled → published restores as before: stamp cleared, seats back, members told', async () => {
    p.event.findUnique.mockResolvedValue(existing())
    const res = await PUT(req({ status: 'published' }), params)
    expect(res.status).toBe(200)
    expect(updateData().cancelledAt).toBeNull()
    expect(p.eventAttendee.findMany.mock.calls[0][0].where).toMatchObject({ eventId: 'e1', status: 'removed', cancelledAt: { gte: stamp } })
    expect(p.eventAttendee.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1', 'r2'] }, status: 'removed' },
      data:  { status: 'approved', cancelledAt: null, cancelledBy: null },
    })
    expect(h.backfillSeatPayments).toHaveBeenCalledWith('e1')
    expect(backOnNotices().map((c: any[]) => c[0]).sort()).toEqual(['u1', 'u2'])
    expect(h.writeAudit.mock.calls.some((c: any[]) => c[2] === 'event.restore')).toBe(true)
  })

  it('staff publishing a cancelled event that was parked as draft still restores it', async () => {
    p.event.findUnique.mockResolvedValue(existing({ status: 'draft' }))
    const res = await PUT(req({ status: 'published' }), params)
    expect(res.status).toBe(200)
    expect(updateData().cancelledAt).toBeNull()
    expect(backOnNotices()).toHaveLength(2)
  })

  it('re-cancelling an archived cancelled event keeps the original stamp and emails nobody again', async () => {
    p.event.findUnique.mockResolvedValue(existing({ status: 'archived' }))
    const res = await PUT(req({ status: 'cancelled' }), params)
    expect(res.status).toBe(200)
    expect(updateData()).not.toHaveProperty('cancelledAt')
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
    expect(h.email.sendEventCancelledEmail).not.toHaveBeenCalled()
  })

  it('a first cancel still stamps and releases', async () => {
    p.event.findUnique.mockResolvedValue(existing({ status: 'published', cancelledAt: null }))
    p.eventAttendee.findMany.mockResolvedValue([])
    const res = await PUT(req({ status: 'cancelled' }), params)
    expect(res.status).toBe(200)
    expect(updateData().cancelledAt).toBeInstanceOf(Date)
    expect(p.eventAttendee.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'removed', cancelledBy: 'admin' })
  })
})

// ── b ──────────────────────────────────────────────────────────────────────
describe('b. PATCH: only published un-cancels', () => {
  beforeEach(() => { h.getSession.mockResolvedValue(mod) })

  it.each(['flagged', 'unpublished', 'pending'])('cancelled → %s keeps cancelledAt; no restore, no notices', async (status) => {
    p.event.findUnique.mockResolvedValue(existing())
    const res = await PATCH(req({ status }), params)
    expect(res.status).toBe(200)
    expect(updateData()).toEqual({ status })
    expectNothingRestored()
    expect(h.writeAudit.mock.calls[0][3]).toBe('e1')
    expect(h.writeAudit.mock.calls[0][5]).toEqual({ status })
  })

  it('cancelled → published restores as before', async () => {
    p.event.findUnique.mockResolvedValue(existing())
    const res = await PATCH(req({ status: 'published' }), params)
    expect(res.status).toBe(200)
    expect(updateData()).toEqual({ status: 'published', cancelledAt: null })
    expect(p.eventAttendee.updateMany).toHaveBeenCalledTimes(1)
    expect(backOnNotices()).toHaveLength(2)
    expect(h.writeAudit.mock.calls[0][5]).toEqual({ status: 'published', restoredFromCancelled: true, restoredSeats: 2 })
  })

  it('a cancelled event sent back to pending restores when staff approve it', async () => {
    p.event.findUnique.mockResolvedValue(existing({ status: 'pending' }))
    const res = await PATCH(req({ status: 'published' }), params)
    expect(res.status).toBe(200)
    expect(updateData()).toEqual({ status: 'published', cancelledAt: null })
    expect(backOnNotices()).toHaveLength(2)
  })
})

// ── c ──────────────────────────────────────────────────────────────────────
describe('c. a host cannot republish a cancelled-then-parked event', () => {
  beforeEach(() => {
    h.getSession.mockResolvedValue(host)
    h.isClubHost.mockResolvedValue(true)
  })

  it.each(['draft', 'postponed'])('cancelled → %s → published is refused even with a staff publish on record', async (parked) => {
    p.event.findUnique.mockResolvedValue(existing({ status: parked }))
    const res = await PUT(req({ status: 'published' }), params)
    expect(res.status).toBe(403)
    expect(p.event.update).not.toHaveBeenCalled()
    expect(h.createNotification).not.toHaveBeenCalled()
  })

  it('the parked-live reopen still works for an event that was never cancelled', async () => {
    p.event.findUnique.mockResolvedValue(existing({ status: 'draft', cancelledAt: null }))
    const res = await PUT(req({ status: 'published' }), params)
    expect(res.status).toBe(200)
    expect(h.wasStaffPublished).toHaveBeenCalledWith('e1')
  })

  it('a host moving their cancelled event to draft keeps it cancelled', async () => {
    p.event.findUnique.mockResolvedValue(existing())
    const res = await PUT(req({ status: 'draft' }), params)
    expect(res.status).toBe(200)
    expectNothingRestored()
  })
})

// ── d ──────────────────────────────────────────────────────────────────────
describe('d. sweeps skip an archived cancelled event', () => {
  // Stands in for the DB filter: honours `cancelledAt: null` when the query sets it.
  const matches = (where: any, e: { cancelledAt: Date | null }) => !('cancelledAt' in where) || (where.cancelledAt === null ? !e.cancelledAt : true)

  it('the survey sweep asks only the event that happened', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
    p.city.findMany.mockResolvedValue([{ id: 'c1', timezone: 'Europe/Istanbul' }])
    const live      = { id: 'live', title: 'Walk', emoji: '🚶', date: '2026-09-12', time: '19:00', endTime: null, hostId: 'host', cityId: 'c1', cancelledAt: null }
    const cancelled = { ...live, id: 'gone', title: 'Picnic', cancelledAt: stamp }
    p.event.findMany.mockImplementation(async ({ where }: any) =>
      where.surveyDispatchedAt === null ? [live, cancelled].filter(e => matches(where, e)) : [])
    p.eventAttendee.findMany.mockResolvedValue([{ userId: 'a' }])
    p.eventCoHost.findMany.mockResolvedValue([])
    p.event.update.mockResolvedValue({})

    const res = await surveysSweep(cronReq())
    expect(res.status).toBe(200)
    for (const call of p.event.findMany.mock.calls) expect(call[0].where.cancelledAt).toBeNull()
    expect(h.createNotification.mock.calls.map((c: any[]) => c[4])).toEqual(['/events/live/feedback'])
    expect(p.event.update).toHaveBeenCalledTimes(1)
    expect(p.event.update.mock.calls[0][0].where).toEqual({ id: 'live' })
  })

  it('the reminders cron asks no review and suggests no connections for it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
    p.city.findMany.mockResolvedValue([{ id: 'c1', timezone: 'Europe/Istanbul' }])
    h.citiesByToday.mockImplementation(async (off = 0) => [{ date: ['2026-09-13', '2026-09-14', '2026-09-15'][off + 1], cityIds: ['c1'] }])
    p.event.updateMany.mockResolvedValue({ count: 0 })
    p.listing.updateMany.mockResolvedValue({ count: 0 })
    p.visitorAnnouncement.updateMany.mockResolvedValue({ count: 0 })
    p.listing.findMany.mockResolvedValue([])
    p.notification.findMany.mockResolvedValue([])
    p.notificationPreference.findMany.mockResolvedValue([])
    const person = (id: string) => ({
      userId: id, status: 'approved', checkedIn: true, attendance: 'unknown', cancelledAt: null, cancelledBy: null,
      user: { id, name: id, email: `${id}@x`, role: 'member' },
    })
    const base = { title: 'Walk', emoji: '🚶', date: '2026-09-13', time: '19:00', cityId: 'c1', hostId: 'host', status: 'archived', cohosts: [], club: null }
    const live      = { ...base, id: 'live', cancelledAt: null,  attendees: [person('a'), person('b')] }
    const cancelled = { ...base, id: 'gone', cancelledAt: stamp, attendees: [person('c'), person('d')] }
    p.event.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'published' ? [] : [live, cancelled].filter(e => matches(where, e)))

    const res = await remindersGET(cronReq())
    expect(res.status).toBe(200)
    const sentTo = (type: string) => h.createNotification.mock.calls.filter((c: any[]) => c[1] === type).map((c: any[]) => c[0]).sort()
    expect(sentTo('review_request')).toEqual(['a', 'b'])
    expect(sentTo('connection_suggestion')).toEqual(['a', 'b'])
    expect(h.email.sendReviewRequestEmail.mock.calls.map((c: any[]) => c[0]).sort()).toEqual(['a@x', 'b@x'])
  })
})

// ── e ──────────────────────────────────────────────────────────────────────
describe('e. the list menus say a parked cancelled event stays cancelled', () => {
  it.each(['app/admin/events/page.tsx', 'app/host/events/page.tsx'])('%s', (file) => {
    const src = read(file)
    expect(src).toMatch(/status === 'cancelled' \? 'Archive \(stays cancelled\)'/)
    expect(src).toMatch(/status === 'cancelled' \? 'Draft \(stays cancelled\)'/)
    expect(src).toMatch(/status === 'cancelled' \? 'Postpone \(stays cancelled\)'/)
  })
})
