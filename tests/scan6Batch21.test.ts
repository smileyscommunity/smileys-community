import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

// Sixth scan, batch 21 — low-severity admin fixes.
//   b. hostless club-request counts: one rule for count, list and the admin
//      clubs pill — a request needs staff when its club is inactive (hosts
//      can't act there) or has no approved host
//   c. useModCounts: a fetch still out when the hook is disabled can't write
//      the previous moderator's counts (generation guard in lib/modCounts)
//   d. moderation page: a 409 "already handled" closes the modal, reloads and
//      says so

const h = vi.hoisted(() => {
  const state: { pending: any[]; hosted: string[] } = { pending: [], hosted: [] }
  const findMany = vi.fn(async (a: any) => {
    if (a.where.role === 'host') {
      return state.hosted.filter(id => a.where.clubId.in.includes(id)).map(clubId => ({ clubId }))
    }
    return state.pending
  })
  return { state, findMany, getSession: vi.fn() }
})

vi.mock('@/lib/prisma',  () => ({ prisma: { clubMembership: { findMany: h.findMany } } }))
vi.mock('@/lib/session', () => ({ getSession: h.getSession }))

import { countHostlessClubRequests } from '@/lib/clubRequests'
import { GET as clubRequestsGET } from '@/app/api/admin/clubs/requests/route'
import { clubRequestStaffReason, clubStaffQueueReason } from '@/lib/clubRequestRouting'
import { createFetchGeneration } from '@/lib/modCounts'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
const urlReq = (url: string) => ({ url, nextUrl: new URL(url) }) as any
const ADMIN = { id: 'a', role: 'admin', cityId: 'c-bodrum' } as any

const row = (clubId: string, isActive: boolean, userId: string) => ({
  joinedAt: new Date(Date.now() - 3 * 86_400_000),
  user: { id: userId, name: `M ${userId}`, color: '#000' },
  club: { id: clubId, slug: clubId, name: `Club ${clubId}`, emoji: '🎉', cityId: 'c-bodrum', isActive, isPrivate: true, city: { name: 'Bodrum' } },
})

beforeEach(() => {
  vi.clearAllMocks()
  h.state.pending = [
    row('active-hosted',     true,  'u1'),
    row('active-hostless',   true,  'u2'),
    row('inactive-hosted',   false, 'u3'),
    row('inactive-hostless', false, 'u4'),
  ]
  h.state.hosted = ['active-hosted', 'inactive-hosted']
})

describe('b. one rule for which club requests need staff', () => {
  it('the rule: inactive wins, then no host; an active hosted club is the host’s', () => {
    expect(clubRequestStaffReason({ isActive: false, hasHost: true })).toBe('club_inactive')
    expect(clubRequestStaffReason({ isActive: false, hasHost: false })).toBe('club_inactive')
    expect(clubRequestStaffReason({ isActive: true,  hasHost: false })).toBe('no_host')
    expect(clubRequestStaffReason({ isActive: true,  hasHost: true })).toBeNull()
  })

  it('the Mod Home count includes requests to an inactive club that still has a host', async () => {
    expect(await countHostlessClubRequests(ADMIN)).toBe(3)
  })

  it('the default queue lists exactly what the count counts, each flagged with its reason', async () => {
    h.getSession.mockResolvedValue(ADMIN)
    const body = await (await clubRequestsGET(urlReq('http://x/app/api/admin/clubs/requests'))).json()
    const byUser = Object.fromEntries(body.requests.map((r: any) => [r.userId, r.staffReason]))
    expect(byUser).toEqual({ u2: 'no_host', u3: 'club_inactive', u4: 'club_inactive' })
    expect(body.hostlessCount).toBe(body.requests.length)
    expect(body.requests.length).toBe(await countHostlessClubRequests(ADMIN))
    // The inactive club's host is still reported — the flag, not hasHost, decides.
    expect(body.requests.find((r: any) => r.userId === 'u3').hasHost).toBe(true)
  })

  it('?scope=all adds the active hosted club’s request with no staff reason; the count is unchanged', async () => {
    h.getSession.mockResolvedValue(ADMIN)
    const body = await (await clubRequestsGET(urlReq('http://x/app/api/admin/clubs/requests?scope=all'))).json()
    expect(body.requests.map((r: any) => r.userId).sort()).toEqual(['u1', 'u2', 'u3', 'u4'])
    expect(body.requests.find((r: any) => r.userId === 'u1').staffReason).toBeNull()
    expect(body.hostlessCount).toBe(3)
  })

  it('the club-level form: active hostless always; inactive only while requests are pending', () => {
    expect(clubStaffQueueReason({ isActive: true,  hostCount: 0 })).toBe('no_host')
    expect(clubStaffQueueReason({ isActive: true,  hostCount: 2, pendingCount: 5 })).toBeNull()
    expect(clubStaffQueueReason({ isActive: false, hostCount: 1, pendingCount: 2 })).toBe('club_inactive')
    expect(clubStaffQueueReason({ isActive: false, hostCount: 0, pendingCount: 0 })).toBeNull()
    expect(clubStaffQueueReason({ isActive: true })).toBeNull()   // older API without hostCount
  })

  it('the admin clubs pill uses the shared rule instead of its own active-only check', () => {
    const src = read('app/admin/clubs/page.tsx')
    expect(src).toContain("import { clubStaffQueueReason } from '@/lib/clubRequestRouting'")
    expect(src).not.toMatch(/c\.isActive && c\.hostCount === 0/)
    expect(src).toContain("statusFilter === 'no-host'      && !staffQueueReason(c)")
    expect(src).toContain('const staffQueueCount = clubList.filter(c => staffQueueReason(c) !== null).length')
  })

  it('the queue page labels inactive-club requests', () => {
    const src = read('app/admin/club-requests/page.tsx')
    expect(src).toMatch(/r\.staffReason === 'club_inactive' && <span[^>]*>Club inactive<\/span>/)
  })
})

describe('c. a stale mod-counts fetch cannot write after disable', () => {
  it('a generation started before bump is no longer current; a new one is', () => {
    const g = createFetchGeneration()
    const before = g.start()
    expect(g.isCurrent(before)).toBe(true)
    g.bump()
    expect(g.isCurrent(before)).toBe(false)
    const after = g.start()
    expect(g.isCurrent(after)).toBe(true)
    g.bump()
    expect(g.isCurrent(after)).toBe(false)
  })

  it('separate guards do not share a counter', () => {
    const a = createFetchGeneration(), b = createFetchGeneration()
    const ga = a.start()
    b.bump()
    expect(a.isCurrent(ga)).toBe(true)
  })

  it('the hook bumps on disable and checks the generation before writing or clearing flight state', () => {
    const src = read('hooks/useModCounts.ts')
    expect(src).toContain('const generation = createFetchGeneration()')
    expect(src).toContain('const gen = generation.start()')
    expect(src).toContain('if (d == null || !generation.isCurrent(gen)) return')
    expect(src).toMatch(/\.finally\(\(\) => \{[\s\S]*?if \(!generation\.isCurrent\(gen\)\) return\s*\n\s*inFlight = false/)
    expect(src).toMatch(/if \(!enabled\) \{[\s\S]*?generation\.bump\(\)[\s\S]*?sharedCounts = null[\s\S]*?inFlight = false\s*\n\s*rerunAfterFlight = false/)
  })
})

describe('d. moderation: a 409 on a report action', () => {
  it('closes the modal, reloads in the background and shows an info toast', () => {
    const src = read('app/admin/moderation/page.tsx')
    const branch = src.match(/\} else if \(res\.status === 409\) \{([\s\S]*?)\} else \{/)?.[1] ?? ''
    expect(branch).toContain('setSelected(null)')
    expect(branch).toContain("toast.info('Already handled by someone else')")
    expect(branch).toContain('load(true)')
    expect(branch).not.toContain('toast.error')
  })
})
