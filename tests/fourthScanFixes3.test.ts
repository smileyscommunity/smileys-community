import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access',  () => ({ isAdmin: (s: any) => s?.role === 'admin', isClubHost: vi.fn(), canManageEventOps: vi.fn(async () => true) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/email',   () => ({ sendEventApprovedEmail: vi.fn(), sendEventRejectedEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/autoJoinClub', () => ({ autoJoinClub: vi.fn(async () => {}) }))
vi.mock('@/lib/spotsLeft',    () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/audit',        () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/eventQuota',   () => ({ findPromotableFromWaitlist: vi.fn(), hasQuotaRoomFor: vi.fn(), quotaEventSelect: { genderBalance: true, maleQuota: true, femaleQuota: true, turkishMaleQuota: true, totalSpots: true } }))
vi.mock('@/lib/noShow',       () => ({ getRsvpGate: vi.fn(async () => ({ ok: true })), gateErrorBody: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:  vi.fn(async (fn: any) => fn({ waitlistEntry: { deleteMany: vi.fn() }, eventAttendee: { updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() } })),
  event:         { findUnique: vi.fn() },
  user:          { findUnique: vi.fn(async () => ({ gender: 'male', nationality: 'Germany' })), findMany: vi.fn(async () => []) },
  eventAttendee: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  eventCoHost:   { findMany: vi.fn(async () => []) },
  waitlistEntry: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  payment:       { findMany: vi.fn(async () => []) },
  noShowCard:    { findMany: vi.fn(async () => []) },
} }))

import { GET, PUT, POST } from '@/app/api/admin/events/[id]/participants/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { hasQuotaRoomFor } from '@/lib/eventQuota'

const read = (p: string) => readFileSync(p, 'utf-8')
const params = { params: Promise.resolve({ id: 'e1' }) }
const req = (body: any) => ({ json: async () => body }) as any
const p = prisma as any
const EVENT = { title: 'T', spotsLeft: 3, approvalRequired: false, hostId: 'h1', status: 'published', genderBalance: true, maleQuota: 5, femaleQuota: 5, turkishMaleQuota: null, totalSpots: 10 }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'co', name: 'Co', role: 'member' })
  p.event.findUnique.mockResolvedValue(EVENT)
  p.eventAttendee.findUnique.mockResolvedValue(null)
  p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1' })
  ;(hasQuotaRoomFor as any).mockResolvedValue({ ok: true })
})

describe('7 manual seats follow the balance quota', () => {
  it('PUT add refuses a seat the quota has closed, without writing', async () => {
    ;(hasQuotaRoomFor as any).mockResolvedValue({ ok: false, reason: 'male_quota' })
    const res = await PUT(req({ userId: 'u1' }), params)
    expect(res.status).toBe(409)
    expect(p.$transaction).not.toHaveBeenCalled()
  })
  it('POST promote refuses a seat the quota has closed, without writing', async () => {
    ;(hasQuotaRoomFor as any).mockResolvedValue({ ok: false, reason: 'male_quota' })
    const res = await POST(req({ userId: 'u1' }), params)
    expect(res.status).toBe(409)
    expect(p.$transaction).not.toHaveBeenCalled()
  })
  it('both refuse a cancelled or archived event', async () => {
    p.event.findUnique.mockResolvedValue({ ...EVENT, status: 'cancelled' })
    expect((await PUT(req({ userId: 'u1' }), params)).status).toBe(400)
    p.event.findUnique.mockResolvedValue({ ...EVENT, status: 'archived' })
    expect((await POST(req({ userId: 'u1' }), params)).status).toBe(400)
    expect(p.$transaction).not.toHaveBeenCalled()
  })
})

describe('7 promote makes the checks add makes', () => {
  it('refuses someone not on the waitlist', async () => {
    p.waitlistEntry.findUnique.mockResolvedValue(null)
    expect((await POST(req({ userId: 'u1' }), params)).status).toBe(404)
  })
  it('refuses the host', async () => {
    expect((await POST(req({ userId: 'h1' }), params)).status).toBe(400)
  })
  it('refuses a member with a pending request, pointing at approve (it used to 500 on the unique key)', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    const res = await POST(req({ userId: 'u1' }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/approve it instead/)
    expect(p.$transaction).not.toHaveBeenCalled()
  })
  it('promotes when everything checks out', async () => {
    const res = await POST(req({ userId: 'u1' }), params)
    expect(res.status).toBe(200)
    expect(p.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe('8 participants contact details', () => {
  const row = { userId: 'u1', status: 'approved', user: { id: 'u1', name: 'A', email: 'a@x.io', phone: '+90555', gender: 'female', nationality: 'Turkey' } }
  beforeEach(() => { p.eventAttendee.findMany.mockResolvedValue([row]) })

  it('a co-host or club host gets no email or phone, but keeps gender and nationality', async () => {
    const res = await GET(req({}), params)
    const { attendees } = await res.json()
    expect(attendees[0].user).not.toHaveProperty('email')
    expect(attendees[0].user).not.toHaveProperty('phone')
    expect(attendees[0].user).toMatchObject({ gender: 'female', nationality: 'Turkey' })
  })
  it('the primary host and admins still see them', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'h1', name: 'H', role: 'member' })
    expect((await (await GET(req({}), params)).json()).attendees[0].user.email).toBe('a@x.io')
    ;(getSession as any).mockResolvedValue({ id: 'adm', name: 'A', role: 'admin' })
    expect((await (await GET(req({}), params)).json()).attendees[0].user.phone).toBe('+90555')
  })
})

describe('9 post-event feedback', () => {
  it('is rate-limited and files at most one anomaly report per survey', () => {
    const src = read('app/api/events/[id]/feedback/route.ts')
    expect(src).toMatch(/rateLimit\(`feedback:\$\{session\.id\}`, 10, 60_000\)/)
    expect(src).toMatch(/claimOnce\(`survey-anomaly:\$\{session\.id\}:\$\{event\.id\}`/)
    expect(src.indexOf('claimOnce(`survey-anomaly:')).toBeLessThan(src.indexOf('prisma.report.create('))
  })
})

describe('10 availability pulses', () => {
  const route = read('app/api/availability/route.ts')
  it('the feed hides pulses across a block', () => {
    expect(route).toMatch(/\.\.\.\(blocked\.length \? \{ userId: \{ notIn: blocked \} \} : \{\}\)/)
  })
  it('the fan-out stays in the poster\'s city and skips blocked members', () => {
    expect(route).toMatch(/neighborhood: safeNeighborhood, cityId: created\.cityId/)
    expect(route).toMatch(/audience = audience\.filter\(uid => !blockedIds\.has\(uid\)\)/)
  })
  it('a wave across a block answers like an expired pulse', () => {
    const wave = read('app/api/availability/[id]/wave/route.ts')
    expect(wave).toMatch(/if \(await isBlockedEitherWay\(session\.id, pulse\.userId\)\)/)
    expect(wave.indexOf('isBlockedEitherWay(session.id')).toBeLessThan(wave.indexOf('prisma.pulseWave.create('))
  })
})
