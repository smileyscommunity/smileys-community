import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session',  () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access',   () => ({ isAdmin: vi.fn(() => false), canActInCity: vi.fn(() => false) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/audit',    () => ({ writeAudit: vi.fn(async () => undefined) }))
vi.mock('@/lib/city',     () => ({ todayInCity: vi.fn(async () => '2026-09-18') }))
vi.mock('@/lib/neighborhoodsDb', () => ({ safeNeighborhoodFor: vi.fn(async (_c: string, n: unknown) => (typeof n === 'string' && n ? n : null)) }))
vi.mock('next/cache',     () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/visitorNotify', () => ({ notifyLocalsOfVisit: vi.fn(async () => 0) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  visitorAnnouncement: { findUnique: vi.fn(), updateMany: vi.fn() },
} }))

import { GET, PATCH, DELETE } from '@/app/api/visitors/[id]/route'
import { getSession } from '@/lib/session'
import { isAdmin, canActInCity } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'

// A member's own visit card: read back, change, withdraw — and a moderator's
// or admin's takedown, which used to need psql.

const p      = prisma as any
const params = { params: Promise.resolve({ id: 'v1' }) }
const req    = (body?: unknown) => ({ json: async () => body }) as any
const ROW    = { id: 'v1', userId: 'me', cityId: 'c1', status: 'active', name: 'Nate', city: { slug: 'izmir', name: 'Izmir' } }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'me', name: 'Me', role: 'member', cityId: 'c1' })
  p.visitorAnnouncement.findUnique.mockResolvedValue(ROW)
  p.visitorAnnouncement.updateMany.mockResolvedValue({ count: 1 })
})

describe('GET', () => {
  it('returns the owner their card and nobody else', async () => {
    expect((await GET(req(), params)).status).toBe(200)
    ;(getSession as any).mockResolvedValue({ id: 'other', name: 'O', role: 'member' })
    expect((await GET(req(), params)).status).toBe(404)
    ;(getSession as any).mockResolvedValue(null)
    expect((await GET(req(), params)).status).toBe(403)
  })
})

describe('PATCH', () => {
  const body = { name: 'Nate', intro: 'Back for a week', startsOn: '2026-10-01', endsOn: '2026-10-08', neighborhood: 'Alsancak', visibility: 'public', languages: ['en'], lookingFor: ['coffee'] }
  it('validates the dates on the destination city\'s calendar and writes with the owner condition', async () => {
    const res = await PATCH(req(body), params)
    expect(res.status).toBe(200)
    const call = p.visitorAnnouncement.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'v1', userId: 'me', status: 'active' })
    expect(call.data).toMatchObject({ startsOn: '2026-10-01', endsOn: '2026-10-08', neighborhood: 'Alsancak', visibility: 'public' })
    expect(revalidateTag).toHaveBeenCalledWith('visitor-announcements')
    expect((await PATCH(req({ ...body, endsOn: '2026-09-01' }), params)).status).toBe(400)
    expect((await PATCH(req({ ...body, endsOn: '2027-06-01' }), params)).status).toBe(400)
  })
  it("a visit doesn't move city: a different city in the body is refused before anything is written", async () => {
    expect((await PATCH(req({ ...body, city: 'istanbul' }), params)).status).toBe(400)
    expect((await PATCH(req({ ...body, city: 'izmir' }), params)).status).toBe(200)
    expect(p.visitorAnnouncement.updateMany).toHaveBeenCalledTimes(1)
  })

  it('a null body is a 400, not a 500', async () => {
    expect((await PATCH(req(null), params)).status).toBe(400)
  })

  it('only the owner, only while active', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'other', name: 'O', role: 'member' })
    expect((await PATCH(req(body), params)).status).toBe(404)
    ;(getSession as any).mockResolvedValue({ id: 'me', name: 'Me', role: 'member' })
    p.visitorAnnouncement.findUnique.mockResolvedValue({ ...ROW, status: 'withdrawn' })
    expect((await PATCH(req(body), params)).status).toBe(409)
    expect(p.visitorAnnouncement.updateMany).not.toHaveBeenCalled()
  })
})

describe('DELETE', () => {
  it('the owner withdraws; the row stays, the list cache goes', async () => {
    expect((await DELETE(req(), params)).status).toBe(200)
    expect(p.visitorAnnouncement.updateMany).toHaveBeenCalledWith({ where: { id: 'v1', status: 'active' }, data: { status: 'withdrawn' } })
    expect(revalidateTag).toHaveBeenCalledWith('visitor-announcements')
    expect(writeAudit).not.toHaveBeenCalled()
  })
  it('a moderator of the destination city or an admin takes it down, audited; anyone else 404', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'mod', name: 'Mod', role: 'moderator', cityId: 'c1' })
    ;(canActInCity as any).mockReturnValueOnce(true)
    expect((await DELETE(req(), params)).status).toBe(200)
    expect(canActInCity).toHaveBeenCalledWith(expect.objectContaining({ id: 'mod' }), 'c1')
    expect(writeAudit).toHaveBeenCalledWith('mod', 'Mod', 'visitor_announcement_removed', 'v1', 'visitor_announcement', { userId: 'me', cityId: 'c1' }, expect.any(String))
    ;(getSession as any).mockResolvedValue({ id: 'adm', name: 'Adm', role: 'admin' })
    ;(isAdmin as any).mockReturnValueOnce(true)
    expect((await DELETE(req(), params)).status).toBe(200)
    ;(getSession as any).mockResolvedValue({ id: 'other', name: 'O', role: 'member', cityId: 'c1' })
    expect((await DELETE(req(), params)).status).toBe(404)
  })
})
