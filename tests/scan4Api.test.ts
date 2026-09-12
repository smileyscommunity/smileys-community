import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Fourth-scan API fixes: city-scoped club staff overrides, joining only live
// clubs in your own cities, broadcast validation/authz order, participant-op
// guards + rate limits, approved-claim re-posts, and the testimonial race.
// lib/access and lib/attendance run for real so the assertions are on what
// the routes would actually allow and write.

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(), claimOnce: vi.fn(), getIp: vi.fn(() => '1.1.1.1') }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access')>()),
  canManageEventOps: vi.fn(),
}))
vi.mock('@/lib/memberPrivacy', () => ({ restrictedSetFor: vi.fn().mockResolvedValue(new Set()) }))
vi.mock('@/lib/email',        () => ({ sendEventApprovedEmail: vi.fn().mockResolvedValue(undefined), sendEventRejectedEmail: vi.fn().mockResolvedValue(undefined), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/autoJoinClub', () => ({ autoJoinClub: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/spotsLeft',    () => ({ recomputeSpotsLeft: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/audit',        () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/eventQuota',   () => ({ findPromotableFromWaitlist: vi.fn().mockResolvedValue(null), hasQuotaRoomFor: vi.fn().mockResolvedValue({ ok: true }), quotaEventSelect: {} }))
vi.mock('@/lib/noShow',       () => ({ getRsvpGate: vi.fn(), gateErrorBody: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:     vi.fn(),
  club:             { findUnique: vi.fn(), update: vi.fn() },
  clubMembership:   { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), count: vi.fn(), delete: vi.fn() },
  clubResource:     { findFirst: vi.fn(), create: vi.fn() },
  cityRelationship: { findFirst: vi.fn() },
  user:             { findUnique: vi.fn(), findMany: vi.fn() },
  event:            { findUnique: vi.fn() },
  eventAttendee:    { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn() },
  waitlistEntry:    { findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  payment:          { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  paymentLog:       { create: vi.fn(), createMany: vi.fn() },
  business:         { findUnique: vi.fn() },
  businessClaim:    { findUnique: vi.fn(), upsert: vi.fn() },
  testimonial:      { count: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
} }))

import { POST as addResource } from '@/app/api/clubs/[slug]/resources/route'
import { GET as listMembers, PATCH as patchMembers } from '@/app/api/clubs/[slug]/members/route'
import { POST as joinClub, DELETE as leaveClub } from '@/app/api/clubs/[slug]/membership/route'
import { POST as broadcast } from '@/app/api/host/events/[id]/broadcast/route'
import { PATCH as patchParticipants, PUT as putParticipants, POST as postParticipants, DELETE as deleteParticipants } from '@/app/api/admin/events/[id]/participants/route'
import { POST as claimBusiness } from '@/app/api/directory/[id]/claim/route'
import { POST as submitTestimonial } from '@/app/api/testimonials/route'
import { getSession } from '@/lib/session'
import { rateLimit, claimOnce } from '@/lib/rateLimit'
import { canManageEventOps } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { getRsvpGate } from '@/lib/noShow'
import { prisma } from '@/lib/prisma'

const p = prisma as any
const req = (body: any = {}, search = '') => ({
  json: async () => body,
  nextUrl: new URL(`http://x/app/api/test${search}`),
}) as any
const clubParams  = { params: Promise.resolve({ slug: 'sailing' }) }
const eventParams = { params: Promise.resolve({ id: 'e1' }) }
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

const asSession = (s: Record<string, unknown>) => (getSession as any).mockResolvedValue({ name: 'S', ...s })
const ankaraMod   = { id: 'm1', role: 'moderator', cityId: 'ankara' }
const istanbulMod = { id: 'm2', role: 'moderator', cityId: 'istanbul' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(rateLimit as any).mockResolvedValue(true)
  ;(claimOnce as any).mockResolvedValue(true)
  ;(getRsvpGate as any).mockResolvedValue({ ok: true })
  p.$transaction.mockImplementation(async (ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(p))
  p.clubMembership.findUnique.mockResolvedValue(null)
  p.clubMembership.findMany.mockResolvedValue([])
  p.clubMembership.create.mockResolvedValue({})
  p.club.update.mockResolvedValue({})
  p.clubResource.findFirst.mockResolvedValue(null)
  p.clubResource.create.mockImplementation(async ({ data }: any) => ({ id: 'r1', ...data }))
  p.user.findMany.mockResolvedValue([])
  p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
  p.waitlistEntry.upsert.mockResolvedValue({ id: 'w1', userId: 'u1', createdAt: new Date() })
  p.payment.findMany.mockResolvedValue([])
})

// ── 1. City-scoped staff override on club resources / pending requests ──────
describe('1 club staff override is city-scoped', () => {
  const resource = { title: 'Group chat', url: 'https://chat.example/x' }

  it('an Ankara moderator cannot add a resource to an Istanbul club', async () => {
    asSession(ankaraMod)
    p.club.findUnique.mockResolvedValue({ id: 'c1', cityId: 'istanbul' })
    const res = await addResource(req(resource), clubParams)
    expect(res.status).toBe(403)
    expect(p.clubResource.create).not.toHaveBeenCalled()
  })

  it('the club city\'s own moderator can', async () => {
    asSession(istanbulMod)
    p.club.findUnique.mockResolvedValue({ id: 'c1', cityId: 'istanbul' })
    const res = await addResource(req(resource), clubParams)
    expect(res.status).toBe(201)
  })

  it('a global club (null city) follows canActInCity like the siblings: any moderator', async () => {
    asSession(ankaraMod)
    p.club.findUnique.mockResolvedValue({ id: 'c1', cityId: null })
    const res = await addResource(req(resource), clubParams)
    expect(res.status).toBe(201)
  })

  it('an approved host of the club still can, whatever their role', async () => {
    asSession({ id: 'h1', role: 'member', cityId: 'ankara' })
    p.club.findUnique.mockResolvedValue({ id: 'c1', cityId: 'istanbul' })
    p.clubMembership.findUnique.mockResolvedValue({ role: 'host', status: 'approved' })
    const res = await addResource(req(resource), clubParams)
    expect(res.status).toBe(201)
  })

  it('an Ankara moderator cannot read an Istanbul private club\'s pending requests', async () => {
    asSession(ankaraMod)
    p.club.findUnique.mockResolvedValue({ id: 'c1', isPrivate: true, cityId: 'istanbul' })
    // Approved member of the club, so the roster gate passes — the pending
    // list is the host/staff-only part.
    p.clubMembership.findUnique.mockResolvedValue({ role: 'member', status: 'approved' })
    const res = await listMembers(req({}, '?pending=1'), clubParams)
    expect(res.status).toBe(403)
    expect(p.clubMembership.findMany).not.toHaveBeenCalled()
  })

  it('the club city\'s moderator can read them', async () => {
    asSession(istanbulMod)
    p.club.findUnique.mockResolvedValue({ id: 'c1', isPrivate: true, cityId: 'istanbul' })
    const res = await listMembers(req({}, '?pending=1'), clubParams)
    expect(res.status).toBe(200)
  })
})

// ── 2. Joining a club ───────────────────────────────────────────────────────
describe('2 joining a club: live clubs in your own cities only', () => {
  beforeEach(() => {
    asSession({ id: 'u1', role: 'member' })
    p.user.findUnique.mockResolvedValue({ status: 'approved', cityId: 'ankara', name: 'U' })
  })

  it('an inactive club → 404, nothing written', async () => {
    p.club.findUnique.mockResolvedValue({ id: 'c1', slug: 'sailing', isPrivate: false, isActive: false, cityId: 'ankara' })
    const res = await joinClub(req(), clubParams)
    expect(res.status).toBe(404)
    expect(p.clubMembership.create).not.toHaveBeenCalled()
    expect(p.club.update).not.toHaveBeenCalled()
  })

  it('a club in a city the member has not joined → 403, nothing written', async () => {
    p.club.findUnique.mockResolvedValue({ id: 'c1', slug: 'sailing', isPrivate: false, isActive: true, cityId: 'istanbul' })
    p.cityRelationship.findFirst.mockResolvedValue(null)
    const res = await joinClub(req(), clubParams)
    expect(res.status).toBe(403)
    expect(p.cityRelationship.findFirst.mock.calls[0][0].where).toEqual({ userId: 'u1', cityId: 'istanbul', type: 'member' })
    expect(p.clubMembership.create).not.toHaveBeenCalled()
  })

  it('a club in a city the member joined as a second city → allowed', async () => {
    p.club.findUnique.mockResolvedValue({ id: 'c1', slug: 'sailing', isPrivate: false, isActive: true, cityId: 'istanbul' })
    p.cityRelationship.findFirst.mockResolvedValue({ id: 'cr1' })
    const res = await joinClub(req(), clubParams)
    expect(res.status).toBe(200)
    expect(p.clubMembership.create).toHaveBeenCalledWith({ data: { userId: 'u1', clubId: 'c1', status: 'approved' } })
  })

  it('a club in the home city → allowed without a relationship lookup', async () => {
    p.club.findUnique.mockResolvedValue({ id: 'c1', slug: 'sailing', isPrivate: false, isActive: true, cityId: 'ankara' })
    const res = await joinClub(req(), clubParams)
    expect(res.status).toBe(200)
    expect(p.cityRelationship.findFirst).not.toHaveBeenCalled()
  })

  it('a global club (null city) → allowed from any city', async () => {
    p.club.findUnique.mockResolvedValue({ id: 'c1', slug: 'languages', isPrivate: false, isActive: true, cityId: null })
    const res = await joinClub(req(), clubParams)
    expect(res.status).toBe(200)
    expect(p.cityRelationship.findFirst).not.toHaveBeenCalled()
  })

  it('leaving stays allowed, even from an inactive club in another city', async () => {
    p.club.findUnique.mockResolvedValue({ id: 'c1', slug: 'sailing', isPrivate: false, isActive: false, cityId: 'istanbul' })
    p.clubMembership.findUnique.mockResolvedValue({ role: 'member', status: 'approved' })
    p.clubMembership.delete.mockResolvedValue({})
    const res = await leaveClub(req(), clubParams)
    expect(res.status).toBe(200)
    expect(p.clubMembership.delete).toHaveBeenCalled()
  })
})

// ── 3. Host broadcast ───────────────────────────────────────────────────────
describe('3 host broadcast', () => {
  beforeEach(() => {
    asSession({ id: 'ch', role: 'member' })
    p.event.findUnique.mockResolvedValue({ id: 'e1', title: 'Picnic', hostId: 'h1', clubId: null })
    ;(canManageEventOps as any).mockResolvedValue(true)
  })

  it.each([[42], [{ text: 'hi' }], [['a']]])('a non-string message (%j) → 400, not 500, and no budget spent', async (message) => {
    const res = await broadcast(req({ message }), eventParams)
    expect(res.status).toBe(400)
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('an unauthorised caller → 403 without consuming the rate-limit counter', async () => {
    ;(canManageEventOps as any).mockResolvedValue(false)
    const res = await broadcast(req({ message: 'Doors at 7' }), eventParams)
    expect(res.status).toBe(403)
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('an authorised caller is rate-limited', async () => {
    ;(rateLimit as any).mockResolvedValue(false)
    const res = await broadcast(req({ message: 'Doors at 7' }), eventParams)
    expect(res.status).toBe(429)
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('the sender is neither notified nor counted in `sent`', async () => {
    p.eventAttendee.findMany.mockImplementation(async ({ where }: any) =>
      [{ userId: 'ch' }, { userId: 'u1' }, { userId: 'u2' }].filter(a => a.userId !== where.userId?.not))
    const res = await broadcast(req({ message: 'Doors at 7' }), eventParams)
    expect(res.status).toBe(200)
    expect(p.eventAttendee.findMany.mock.calls[0][0].where).toEqual({ eventId: 'e1', status: 'approved', userId: { not: 'ch' } })
    expect((await res.json()).sent).toBe(2)
    expect((createNotification as any).mock.calls.map((c: any) => c[0])).toEqual(['u1', 'u2'])
  })
})

// ── 5. Participants PATCH guards + rate limits ──────────────────────────────
describe('5 participants ops', () => {
  const writeMocks = () => [
    p.eventAttendee.update, p.eventAttendee.updateMany, p.eventAttendee.create,
    p.waitlistEntry.delete, p.waitlistEntry.deleteMany, p.waitlistEntry.upsert,
    p.payment.update, p.payment.create, p.payment.updateMany,
    p.paymentLog.create, p.paymentLog.createMany,
  ]

  beforeEach(() => {
    asSession({ id: 'a1', role: 'admin' })
    ;(canManageEventOps as any).mockResolvedValue(true)
    p.event.findUnique.mockResolvedValue({ title: 'Picnic', price: 300, currency: 'TRY', status: 'published', totalSpots: 10 })
    p.user.findUnique.mockResolvedValue({ name: 'M', email: 'm@x', gender: null, nationality: null })
  })

  it.each([
    ['missing', {}],
    ['a number', { userId: 7 }],
    ['empty', { userId: '' }],
  ])('5a markPaid with a %s userId → 400, no payment looked up or touched', async (_label, body) => {
    const res = await patchParticipants(req({ action: 'markPaid', ...body }), eventParams)
    expect(res.status).toBe(400)
    expect(p.payment.findFirst).not.toHaveBeenCalled()
    for (const m of writeMocks()) expect(m).not.toHaveBeenCalled()
  })

  it('5a markUnpaid without a userId → 400 too', async () => {
    const res = await patchParticipants(req({ action: 'markUnpaid' }), eventParams)
    expect(res.status).toBe(400)
    expect(p.payment.findFirst).not.toHaveBeenCalled()
  })

  it.each([['promote'], [undefined], [42]])('5b an unknown action (%j) → 400, not a silent 200', async (action) => {
    const res = await patchParticipants(req({ userId: 'u1', action }), eventParams)
    expect(res.status).toBe(400)
    for (const m of writeMocks()) expect(m).not.toHaveBeenCalled()
  })

  it.each(['cancelled', 'archived'])('5c toWaitlist on a %s event → 400, seat and queue untouched', async (status) => {
    asSession({ id: 'h1', role: 'host' })
    p.event.findUnique.mockResolvedValue({ title: 'Picnic', status, totalSpots: 10 })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    const res = await patchParticipants(req({ userId: 'u1', action: 'toWaitlist' }), eventParams)
    expect(res.status).toBe(400)
    for (const m of writeMocks()) expect(m).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('5c toWaitlist on a published event still works', async () => {
    asSession({ id: 'h1', role: 'host' })
    p.event.findUnique.mockResolvedValue({ title: 'Picnic', status: 'published', totalSpots: 10 })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    const res = await patchParticipants(req({ userId: 'u1', action: 'toWaitlist' }), eventParams)
    expect(res.status).toBe(200)
    expect(p.waitlistEntry.upsert).toHaveBeenCalled()
  })

  it.each([
    ['PATCH',  patchParticipants,  { userId: 'u1', action: 'approve' }],
    ['PUT',    putParticipants,    { userId: 'u1' }],
    ['POST',   postParticipants,   { userId: 'u1' }],
    ['DELETE', deleteParticipants, { userId: 'u1' }],
  ] as const)('5d %s is rate-limited per session', async (_m, handler, body) => {
    ;(rateLimit as any).mockResolvedValue(false)
    const res = await (handler as any)(req(body), eventParams)
    expect(res.status).toBe(429)
    expect(rateLimit).toHaveBeenCalledWith('participants-ops:a1', 120, 60_000)
    for (const m of writeMocks()) expect(m).not.toHaveBeenCalled()
  })
})

// ── 6. Business claim re-post by the approved owner ─────────────────────────
describe('6 directory claim', () => {
  beforeEach(() => {
    asSession({ id: 'u1', role: 'member', name: 'Owner' })
    p.businessClaim.upsert.mockResolvedValue({ id: 'bc1', status: 'pending' })
  })

  it('the approved owner re-posting → 400, the approved claim is not reset', async () => {
    p.business.findUnique.mockResolvedValue({ id: 'b1', name: 'Cafe', isApproved: true, isActive: true, claimedById: 'u1' })
    p.businessClaim.findUnique.mockResolvedValue({ status: 'approved' })
    const res = await claimBusiness(req({ message: 'It is mine' }), eventParams)
    expect(res.status).toBe(400)
    expect(p.businessClaim.upsert).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('an approved claim row alone (ownership not yet stamped) is also left intact', async () => {
    p.business.findUnique.mockResolvedValue({ id: 'b1', name: 'Cafe', isApproved: true, isActive: true, claimedById: null })
    p.businessClaim.findUnique.mockResolvedValue({ status: 'approved' })
    const res = await claimBusiness(req({ message: 'It is mine' }), eventParams)
    expect(res.status).toBe(400)
    expect(p.businessClaim.upsert).not.toHaveBeenCalled()
  })

  it('a rejected claimant can still re-submit → back to pending', async () => {
    p.business.findUnique.mockResolvedValue({ id: 'b1', name: 'Cafe', isApproved: true, isActive: true, claimedById: null })
    p.businessClaim.findUnique.mockResolvedValue({ status: 'rejected' })
    const res = await claimBusiness(req({ message: 'New proof attached' }), { params: Promise.resolve({ id: 'b1' }) })
    expect(res.status).toBe(200)
    expect(p.businessClaim.upsert.mock.calls[0][0].update).toMatchObject({ status: 'pending' })
  })
})

// ── 7. Testimonial submit ───────────────────────────────────────────────────
describe('7 testimonial submit', () => {
  const quote = 'Smileys got me out of the house and into real friendships.'

  beforeEach(() => {
    asSession({ id: 'u1', role: 'member' })
    p.testimonial.count.mockResolvedValue(0)
    p.testimonial.aggregate.mockResolvedValue({ _max: { order: 3 } })
    p.testimonial.create.mockResolvedValue({ id: 't1' })
    p.user.findUnique.mockResolvedValue({ name: 'Sara Kaya', profilePhoto: '/app/api/files/users/abc.jpg', joinedAt: new Date('2025-01-01'), cityId: 'istanbul' })
  })

  it('7a a concurrent second post loses the claim → 409, no second quote', async () => {
    ;(claimOnce as any).mockResolvedValue(false)
    const res = await submitTestimonial(req({ quote }))
    expect(res.status).toBe(409)
    expect(claimOnce).toHaveBeenCalledWith('testimonial-once:u1', expect.any(Number))
    expect(p.testimonial.create).not.toHaveBeenCalled()
  })

  it('7a the claim is taken only after the count check passes', async () => {
    p.testimonial.count.mockResolvedValue(1)
    const res = await submitTestimonial(req({ quote }))
    expect(res.status).toBe(409)
    expect(claimOnce).not.toHaveBeenCalled()
  })

  it('7a the first post goes through with the member\'s users/ avatar', async () => {
    const res = await submitTestimonial(req({ quote }))
    expect(res.status).toBe(200)
    expect(p.testimonial.create.mock.calls[0][0].data).toMatchObject({ photo: '/app/api/files/users/abc.jpg', userId: 'u1', active: false })
  })

  it.each([
    '/app/api/files/applications/abc.jpg',
    '/app/api/files/users/nested/abc.jpg',
    'https://example.com/me.jpg',
  ])('7b a profilePhoto outside users/ (%s) is dropped', async (photo) => {
    p.user.findUnique.mockResolvedValue({ name: 'Sara Kaya', profilePhoto: photo, joinedAt: null, cityId: 'istanbul' })
    await submitTestimonial(req({ quote }))
    expect(p.testimonial.create.mock.calls[0][0].data.photo).toBeNull()
  })
})

// ── 4. Type validation (behaviour where cheap, source pins for the rest) ────
describe('4 wrong-typed string fields → 400', () => {
  it('club resources: non-string title/url/emoji and an over-long emoji', async () => {
    asSession(istanbulMod)
    p.club.findUnique.mockResolvedValue({ id: 'c1', cityId: 'istanbul' })
    for (const body of [
      { title: 5, url: 'https://x.y' },
      { title: 'T', url: ['https://x.y'] },
      { title: 'T', url: 'https://x.y', emoji: 1 },
      { title: 'T', url: 'https://x.y', emoji: 'x'.repeat(17) },
    ]) {
      const res = await addResource(req(body), clubParams)
      expect(res.status).toBe(400)
    }
    expect(p.clubResource.create).not.toHaveBeenCalled()
  })

  it('club members PATCH: a non-string userId', async () => {
    asSession(istanbulMod)
    const res = await patchMembers(req({ userId: { not: 'x' }, action: 'approve' }), clubParams)
    expect(res.status).toBe(400)
    expect(p.club.findUnique).not.toHaveBeenCalled()
  })

  it('photos, spotlight, wall posts and replies type-check before .trim()', () => {
    expect(read('app/api/clubs/[slug]/photos/route.ts')).toMatch(/typeof url !== 'string' \|\| \(caption != null && typeof caption !== 'string'\)/)
    expect(read('app/api/clubs/[slug]/spotlight/route.ts')).toMatch(/\(name != null && typeof name !== 'string'\) \|\| \(note != null && typeof note !== 'string'\)/)
    expect(read('app/api/neighborhoods/[slug]/posts/route.ts')).toMatch(/content != null && typeof content !== 'string'/)
    expect(read('app/api/neighborhoods/[slug]/posts/[postId]/replies/route.ts')).toMatch(/content != null && typeof content !== 'string'/)
  })
})

// ── 8. Rate limits on the remaining mutations ───────────────────────────────
describe('8 per-session rate limits', () => {
  it.each([
    ['app/api/handbook/[slug]/like/route.ts',                     'handbook-like:${session.id}'],
    ['app/api/neighborhoods/[slug]/posts/[postId]/like/route.ts', 'nh-like:${session.id}'],
    ['app/api/directory/[id]/route.ts',                           'directory-owner-patch:${session.id}'],
    ['app/api/me/listing-alerts/route.ts',                        'listing-alerts:${session.id}'],
  ])('%s', (file, key) => {
    const src = read(file)
    expect(src).toContain(`if (!await rateLimit(\`${key}\``)
    // Limited after the session check, before any read or write.
    expect(src.indexOf('rateLimit(`')).toBeGreaterThan(src.indexOf('if (!session)'))
    const firstRead = src.includes('await params') ? src.indexOf('await params') : src.indexOf('req.json()')
    expect(firstRead).toBeGreaterThan(-1)
    expect(src.indexOf('rateLimit(`')).toBeLessThan(firstRead)
  })
})
