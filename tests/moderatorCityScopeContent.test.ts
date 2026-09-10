import { describe, it, expect, vi, beforeEach } from 'vitest'

// Moderators are city-scoped (lib/access canActInCity). The admin routes were
// swept for this on 2026-09-03; the member-facing content routes still used
// the bare isAdminOrModerator override, so an İzmir moderator could remove
// Istanbul board posts, sales, wall posts, guide tips, rewrite club rules and
// approve club memberships. These pin the override to the resource's city.

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  boardPost:        { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  movingSale:       { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({ id: 's1' }) },
  club:             { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({ id: 'c1' }) },
  clubMembership:   { findUnique: vi.fn().mockResolvedValue(null) },
  guideTip:         { findUnique: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
  neighborhoodPost: { findUnique: vi.fn(), delete: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({ id: 'p1', isPinned: true }) },
} }))

import { DELETE as deleteBoardPost } from '@/app/api/board/[id]/route'
import { PATCH as patchSale } from '@/app/api/moving-sales/[id]/route'
import { PUT as putRules } from '@/app/api/clubs/[slug]/rules/route'
import { DELETE as deleteTip } from '@/app/api/guide/[slug]/tips/route'
import { DELETE as deleteWallPost, PATCH as pinWallPost } from '@/app/api/neighborhoods/[slug]/posts/[postId]/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const p = prisma as any
const req = (body: any = {}, url = 'http://x/app/api/x') => ({ json: async () => body, nextUrl: new URL(url) }) as any
const izmirMod = { id: 'mod', name: 'Mod', role: 'moderator', cityId: 'izmir' }
const admin    = { id: 'adm', name: 'Adm', role: 'admin',     cityId: 'izmir' }

beforeEach(() => {
  vi.clearAllMocks()
  p.boardPost.findUnique.mockResolvedValue({ userId: 'author', cityId: 'istanbul' })
  p.movingSale.findUnique.mockResolvedValue({ userId: 'author', cityId: 'istanbul' })
  p.club.findUnique.mockResolvedValue({ id: 'c1', cityId: 'istanbul' })
  p.guideTip.findUnique.mockResolvedValue({ userId: 'author', slug: 'g', cityId: 'istanbul' })
  p.neighborhoodPost.findUnique.mockResolvedValue({ userId: 'author', cityId: 'istanbul' })
})

const cases: Array<[string, (s: any) => Promise<Response>]> = [
  ['board post removal',   () => deleteBoardPost(req(), { params: Promise.resolve({ id: 'b1' }) })],
  ['moving sale removal',  () => patchSale(req({ status: 'removed' }), { params: Promise.resolve({ id: 's1' }) })],
  ['club rules',           () => putRules(req({ rules: 'be nice' }), { params: Promise.resolve({ slug: 'c' }) })],
  ['guide tip deletion',   () => deleteTip(req({}, 'http://x/app/api/guide/g/tips?tip=t1'), { params: Promise.resolve({ slug: 'g' }) })],
  ['wall post deletion',   () => deleteWallPost(req(), { params: Promise.resolve({ slug: 'moda', postId: 'p1' }) })],
  ['wall post pinning',    () => pinWallPost(req({ isPinned: true }), { params: Promise.resolve({ slug: 'moda', postId: 'p1' }) })],
]

describe.each(cases)('%s', (_label, call) => {
  it('refuses a moderator from another city', async () => {
    ;(getSession as any).mockResolvedValue(izmirMod)
    const res = await call(izmirMod)
    expect([403, 404]).toContain(res.status)
  })
  it('allows the city\'s own moderator', async () => {
    ;(getSession as any).mockResolvedValue({ ...izmirMod, cityId: 'istanbul' })
    const res = await call(izmirMod)
    expect(res.status).toBe(200)
  })
  it('allows an admin anywhere', async () => {
    ;(getSession as any).mockResolvedValue(admin)
    const res = await call(admin)
    expect(res.status).toBe(200)
  })
})
