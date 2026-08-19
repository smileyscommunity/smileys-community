import { describe, it, expect, vi, beforeEach } from 'vitest'

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
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/email',   () => ({ sendBroadcastEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    city:      { findUnique: vi.fn() },
    user:      { findMany: vi.fn(async () => []) },
    event:     { findUnique: vi.fn() },
    club:      { findUnique: vi.fn() },
    broadcast: { create: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
  },
}))

import { POST } from '@/app/api/admin/notifications/broadcast/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const admin = { id: 'a1', name: 'A', role: 'admin',     cityId: 'c-ist' }
const mod   = { id: 'm1', name: 'M', role: 'moderator', cityId: 'c-ist' }

function post(body: Record<string, unknown>) {
  return POST(new Request('https://x/app/api/admin/notifications/broadcast', {
    method: 'POST',
    body: JSON.stringify({ title: 'T', message: 'M', channel: 'in-app', ...body }),
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(admin)
  ;(prisma.city.findUnique as any).mockImplementation(async ({ where }: any) =>
    ['c-ist', 'c-bod'].includes(where.id) ? { id: where.id } : null)
})

describe('broadcast city audience', () => {
  it('sends to exactly the approved users of the named city', async () => {
    const res = await post({ audience: 'city', cityId: 'c-bod' })
    expect(res.status).toBe(200)
    expect((prisma.user.findMany as any).mock.calls[0][0].where)
      .toEqual({ status: 'approved', cityId: 'c-bod' })
    // The audit row records where the send went.
    expect((prisma.broadcast.create as any).mock.calls[0][0].data)
      .toMatchObject({ audience: 'city', cityId: 'c-bod' })
  })

  it('moderator may broadcast to their own city…', async () => {
    ;(getSession as any).mockResolvedValue(mod)
    const res = await post({ audience: 'city', cityId: 'c-ist' })
    expect(res.status).toBe(200)
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
    expect(res.status).toBe(200)
    expect((prisma.user.findMany as any).mock.calls[0][0].where).toEqual({ status: 'approved' })
    expect((prisma.broadcast.create as any).mock.calls[0][0].data).toMatchObject({ cityId: null })
  })
})
