import { describe, it, expect, vi, beforeEach } from 'vitest'

// S9 + S11 from the deep scan's low-severity tail. Both are read-path leaks:
// content or PII reaching a viewer who shouldn't have it. Pinned because the
// failure is silent — the response still looks normal, just with too much in it.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access', () => ({
  isAdmin:            (s: any) => s?.role === 'admin',
  isAdminOrModerator: (s: any) => s?.role === 'admin' || s?.role === 'moderator',
}))

const bannersStore = {
  dashboard: [{ id: 'a', active: true,  headline: 'Live' }, { id: 'b', active: false, headline: 'Draft sponsor' }],
  events:    [], clubs: [], members: [], neighborhoods: [], guide: [],
}
const announcementStore = { text: 'Draft copy', link: '', active: false, updatedAt: 't', updatedBy: 'Staff Name' }

vi.mock('fs', () => ({
  readFileSync:  vi.fn(),   // return value set per test
  writeFileSync: vi.fn(), renameSync: vi.fn(), existsSync: () => true,
}))

import { getSession } from '@/lib/session'

const guest = null
const mod   = { id: 'm', role: 'moderator', cityId: 'c-ist' }
const admin = { id: 'a', role: 'admin', cityId: 'c-ist' }
const req = (url = 'https://x/api') => new Request(url) as never

beforeEach(() => vi.clearAllMocks())

describe('S9 — unreleased admin content is not served to non-staff', () => {
  it('banners GET drops inactive (draft) placements for a guest', async () => {
    const fs = await import('fs')
    ;(fs.readFileSync as any).mockReturnValue(JSON.stringify(bannersStore))
    ;(getSession as any).mockResolvedValue(guest)
    const { GET } = await import('@/app/api/admin/banners/route')
    const body = await (await GET()).json()
    expect(body.dashboard.map((b: any) => b.id)).toEqual(['a'])   // no draft 'b'
  })

  it('banners GET gives an admin the full config including drafts', async () => {
    const fs = await import('fs')
    ;(fs.readFileSync as any).mockReturnValue(JSON.stringify(bannersStore))
    ;(getSession as any).mockResolvedValue(admin)
    const { GET } = await import('@/app/api/admin/banners/route')
    const body = await (await GET()).json()
    expect(body.dashboard.map((b: any) => b.id)).toEqual(['a', 'b'])
  })

  it('announcement GET hides a draft and the staff name from a guest', async () => {
    const fs = await import('fs')
    ;(fs.readFileSync as any).mockReturnValue(JSON.stringify(announcementStore))
    ;(getSession as any).mockResolvedValue(guest)
    const { GET } = await import('@/app/api/admin/announcement/route')
    const body = await (await GET()).json()
    expect(body.active).toBe(false)
    expect(body.text).toBe('')          // draft copy withheld
    expect(body.updatedBy).toBeNull()
  })
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    hangout: {
      findMany: vi.fn(async () => [{ id: 'h1', user: { id: 'u', name: 'N', email: 'real@x.com', color: '#000' }, _count: { joins: 0, messages: 0 } }]),
      count:    vi.fn(async () => 1),
    },
  },
}))

describe('S11 — hangouts oversight is city-scoped and email-masked for moderators', () => {
  it('a moderator query fails closed to their city and masks the creator email', async () => {
    const { prisma } = await import('@/lib/prisma')
    ;(getSession as any).mockResolvedValue(mod)
    const { GET } = await import('@/app/api/admin/hangouts/route')
    const body = await (await GET(req())).json()
    // city scope reached the where clause…
    expect((prisma.hangout.findMany as any).mock.calls[0][0].where.cityId).toBe('c-ist')
    // …and the email is gone
    expect(body.hangouts[0].user.email).toBe('')
  })

  it('an admin sees all cities and the real email', async () => {
    const { prisma } = await import('@/lib/prisma')
    ;(getSession as any).mockResolvedValue(admin)
    const { GET } = await import('@/app/api/admin/hangouts/route')
    const body = await (await GET(req())).json()
    expect((prisma.hangout.findMany as any).mock.calls[0][0].where.cityId).toBeUndefined()
    expect(body.hangouts[0].user.email).toBe('real@x.com')
  })
})
