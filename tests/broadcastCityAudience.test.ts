import { describe, it, expect, vi, beforeEach } from 'vitest'

// Two cases below assert the step-up 403 on a global send. 2FA is not
// currently required (ADMIN_2FA_REQUIRED is false — lib/totpPolicy.ts, turned
// off 2026-09-07), so mock the policy on to keep testing that this route is
// still wired to the gate. The city-send case that expects 200 is unaffected:
// it passes because a moderator can never satisfy step-up, not because the
// policy is off.
vi.mock('@/lib/totpPolicy', () => ({ ADMIN_2FA_REQUIRED: true }))

// A broadcast's blast radius is the one thing about it you can't undo. The
// audiences were all / club / event, where "all" meant every approved user in
// every city — so an announcement meant for Istanbul had no correct target
// that excluded Bodrum. audience === 'city' fixes that, and these pin its
// three sharp edges:
//
//  - the recipient query must carry the cityId — dropping it sends the
//    network-wide list under a toast that says "City: Bodrum",
//  - a moderator reaches exactly their own city (canSendBroadcasts), because
//    city-wide is the first non-club/event audience they're allowed,
//  - a bad or missing cityId dies before anyone is fetched — an empty send
//    reported as success is how a city's members silently miss an alert.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn(async () => {}), recipientSkipReason: vi.fn(() => null) }))
vi.mock('@/lib/email',   () => ({ sendBroadcastEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn(async () => {}) }))
// Every POST now claims its requestId (scan 5 item 45); a fresh id per call
// always wins the claim, so these cases test audience scoping alone.
vi.mock('@/lib/rateLimit', () => ({ claimOnce: vi.fn(async () => true), releaseClaim: vi.fn(async () => {}), rateLimitRemaining: vi.fn(async () => 5), rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    city:      { findUnique: vi.fn() },
    user:      { findMany: vi.fn(async () => []) },
    event:     { findUnique: vi.fn() },
    club:      { findUnique: vi.fn() },
    broadcast: { create: vi.fn(async () => ({ id: 'b1' })), update: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
    notificationPreference: { findMany: vi.fn(async () => []) },
  },
}))

import { POST } from '@/app/api/admin/notifications/broadcast/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

// totpVerified: a network-wide send is behind requireStepUp; every other
// audience is not, so the plain admin below must still pass those.
const admin = { id: 'a1', name: 'A', role: 'admin',     cityId: 'c-ist', totpVerified: true }
const stale = { id: 'a1', name: 'A', role: 'admin',     cityId: 'c-ist' }
const mod   = { id: 'm1', name: 'M', role: 'moderator', cityId: 'c-ist' }

let seq = 0
function post(body: Record<string, unknown>) {
  return POST(new Request('https://x/app/api/admin/notifications/broadcast', {
    method: 'POST',
    body: JSON.stringify({ title: 'T', message: 'M', channel: 'in-app', requestId: `req-${String(++seq).padStart(6, '0')}`, ...body }),
  }) as never)
}

const member = { id: 'u1', name: 'U', email: 'u@x.test', emailMarketing: true, emailVerified: true, status: 'approved', suspendedUntil: null }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(admin)
  // An audience with nobody in it is a 400 now, so every send that is meant
  // to go through needs one live member behind it.
  ;(prisma.user.findMany as any).mockResolvedValue([member])
  ;(prisma.city.findUnique as any).mockImplementation(async ({ where }: any) =>
    ['c-ist', 'c-bod'].includes(where.id) ? { id: where.id } : null)
})

describe('broadcast city audience', () => {
  it('sends to exactly the approved users of the named city', async () => {
    const res = await post({ audience: 'city', cityId: 'c-bod' })
    expect(res.status).toBe(202)
    expect((prisma.user.findMany as any).mock.calls[0][0].where)
      .toEqual({ status: 'approved', cityId: 'c-bod' })
    // The audit row records where the send went.
    expect((prisma.broadcast.create as any).mock.calls[0][0].data)
      .toMatchObject({ audience: 'city', cityId: 'c-bod' })
  })

  it('moderator may broadcast to their own city…', async () => {
    ;(getSession as any).mockResolvedValue(mod)
    const res = await post({ audience: 'city', cityId: 'c-ist' })
    expect(res.status).toBe(202)
    expect((prisma.user.findMany as any).mock.calls[0][0].where)
      .toEqual({ status: 'approved', cityId: 'c-ist' })
  })

  it('…but not to another one', async () => {
    ;(getSession as any).mockResolvedValue(mod)
    const res = await post({ audience: 'city', cityId: 'c-bod' })
    expect(res.status).toBe(403)
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('unknown city dies before anyone is fetched', async () => {
    const res = await post({ audience: 'city', cityId: 'c-nope' })
    expect(res.status).toBe(400)
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(prisma.broadcast.create).not.toHaveBeenCalled()
  })

  it('city audience without a cityId is a 400, not a silent network-wide send', async () => {
    const res = await post({ audience: 'city' })
    expect(res.status).toBe(400)
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it("plain 'all' still reaches everyone and records no city", async () => {
    const res = await post({ audience: 'all' })
    expect(res.status).toBe(202)
    expect((prisma.user.findMany as any).mock.calls[0][0].where).toEqual({ status: 'approved' })
    expect((prisma.broadcast.create as any).mock.calls[0][0].data).toMatchObject({ cityId: null })
  })

  it("'all' from an admin session that never passed TOTP is a 403 with nothing sent", async () => {
    ;(getSession as any).mockResolvedValue(stale)
    const res = await post({ audience: 'all' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('totp_required')
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(prisma.broadcast.create).not.toHaveBeenCalled()
  })

  // This used to pin the opposite: an event audience with no eventId WAS
  // the global list, gated only by the (disabled) step-up. That fall-through
  // is what the 2026-09-22 review removed — an audience is one of four
  // named things, and a missing id is a 400 before anyone is fetched.
  it('an event audience with no eventId is refused, not quietly everyone', async () => {
    const res = await post({ audience: 'event' })
    expect(res.status).toBe(400)
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(prisma.broadcast.create).not.toHaveBeenCalled()
  })

  it('an audience that is not one of the four is refused the same way', async () => {
    for (const audience of ['Club', 'everyone', '', undefined]) {
      const res = await post({ audience })
      expect(res.status, String(audience)).toBe(400)
    }
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('a filter object where an id should be is refused, not applied', async () => {
    const res = await post({ audience: 'club', clubId: { not: null } })
    expect(res.status).toBe(400)
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('a city send does not step up (a moderator can never pass it)', async () => {
    ;(getSession as any).mockResolvedValue(stale)
    expect((await post({ audience: 'city', cityId: 'c-ist' })).status).toBe(202)
    expect(prisma.broadcast.create).toHaveBeenCalledTimes(1)
  })
})
