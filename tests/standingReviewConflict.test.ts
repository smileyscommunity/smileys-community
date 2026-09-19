import { describe, it, expect, vi, beforeEach } from 'vitest'

// Nobody judges an offence from an event they ran. The door they worked is
// the evidence, so their own account of it cannot also be the verdict — and a
// member's own offence is obviously not theirs to clear.
//
// v1 enforced this on the no-show cards route, and that route's tests were
// the only place it was covered. The route is gone (v1's table is empty and
// nothing writes to it); the rule lives on in standing's offence decision, so
// its coverage moves here rather than disappearing with the page.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access', () => ({
  isAdmin: (s: any) => s?.role === 'admin',
  canModerateReports: () => true,
  failClosedCityId: (s: any) => s?.cityId ?? '__none__',
}))
vi.mock('@/lib/standing', () => ({ resolveDispute: vi.fn(), overturnByStaff: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { standingOffence: { findUnique: vi.fn() } } }))

import { POST } from '@/app/api/admin/standing/offences/[id]/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { resolveDispute, overturnByStaff } from '@/lib/standing'

const p = prisma as any
const params = { params: Promise.resolve({ id: 'o1' }) }
const req = (decision = 'overturn') => new Request('http://x', { method: 'POST', body: JSON.stringify({ decision }) }) as any

const offence = (o: Partial<{ userId: string; hostId: string | null; cohosts: { userId: string }[]; clubHosts: { userId: string }[] }> = {}) => ({
  userId: o.userId ?? 'member1',
  status: 'disputed',
  user:   { cityId: 'ist' },
  event:  {
    hostId:  o.hostId === undefined ? 'someoneelse' : o.hostId,
    cohosts: o.cohosts ?? [],
    club:    { memberships: o.clubHosts ?? [] },
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'm1', role: 'moderator', cityId: 'ist', name: 'Mod' })
})

describe('nobody judges an offence from an event they run', () => {
  const refused = async () => {
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
    expect(resolveDispute).not.toHaveBeenCalled()
    expect(overturnByStaff).not.toHaveBeenCalled()
    return (await res.json()).code
  }

  it('refuses the event host', async () => {
    p.standingOffence.findUnique.mockResolvedValue(offence({ hostId: 'm1' }))
    expect(await refused()).toBeTruthy()
  })

  it('refuses a co-host', async () => {
    p.standingOffence.findUnique.mockResolvedValue(offence({ cohosts: [{ userId: 'm1' }] }))
    expect(await refused()).toBeTruthy()
  })

  it('refuses a host of the event’s club', async () => {
    p.standingOffence.findUnique.mockResolvedValue(offence({ clubHosts: [{ userId: 'm1' }] }))
    expect(await refused()).toBeTruthy()
  })

  it('refuses someone deciding their own offence', async () => {
    p.standingOffence.findUnique.mockResolvedValue(offence({ userId: 'm1' }))
    expect(await refused()).toBeTruthy()
  })

  it('holds an admin to the same rule — seniority is not distance', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'a1', role: 'admin', cityId: 'ist', name: 'Admin' })
    p.standingOffence.findUnique.mockResolvedValue(offence({ hostId: 'a1' }))
    expect(await refused()).toBeTruthy()
  })

  it('lets an unrelated moderator decide', async () => {
    p.standingOffence.findUnique.mockResolvedValue(offence())
    const res = await POST(req(), params)
    expect(res.status).not.toBe(403)
  })
})
