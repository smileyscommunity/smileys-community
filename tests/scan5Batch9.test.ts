import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 36–40.
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => ({
  eventCoHost: { findFirst: vi.fn() },
  city:        { findMany: vi.fn(), findUnique: vi.fn() },
  guideEntry:  { findMany: vi.fn(async () => []) },
}))
const h = vi.hoisted(() => ({ session: null as Record<string, unknown> | null }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))

import { canSeeEvent } from '@/lib/db'
import { GET as guideEntriesGET } from '@/app/api/admin/guide-entries/route'

beforeEach(() => { vi.clearAllMocks(); h.session = null })

describe('36. non-attendees see coloured blanks, not blurred photos', () => {
  it('the avatar strip renders no photo for them', () => {
    const src = read('app/events/[id]/page.tsx')
    expect(src).toContain("const hideWho = !isAdmin && !isHost && myAttendance?.status !== 'approved'")
    expect(src).toContain('const photo = hideWho ? null : avatarUrl(a.user.profilePhoto, 64)')
  })
})

describe('37. events that are not public stay with staff, host and co-hosts', () => {
  const ev = (status: string) => ({ id: 'e1', status, hostId: 'host' })
  it.each(['published', 'cancelled', 'archived', 'postponed'])('a %s event is visible to anyone', async (status) => {
    expect(await canSeeEvent(ev(status), null)).toBe(true)
  })
  it.each(['draft', 'pending', 'flagged', 'unpublished'])('a %s event is hidden from guests and other members', async (status) => {
    p.eventCoHost.findFirst.mockResolvedValue(null)
    expect(await canSeeEvent(ev(status), null)).toBe(false)
    expect(await canSeeEvent(ev(status), { id: 'someone', role: 'member' })).toBe(false)
  })
  it('the host, a co-host and staff can see a draft', async () => {
    expect(await canSeeEvent(ev('draft'), { id: 'host', role: 'member' })).toBe(true)
    expect(await canSeeEvent(ev('draft'), { id: 'm', role: 'moderator' })).toBe(true)
    p.eventCoHost.findFirst.mockResolvedValue({ id: 'c' })
    expect(await canSeeEvent(ev('draft'), { id: 'co', role: 'member' })).toBe(true)
  })
  it('the page, its metadata and the event API all apply it', () => {
    const page = read('app/events/[id]/page.tsx')
    expect(page).toContain('if (!(await canSeeEvent(event, session))) notFound()')
    expect(page).toContain("if (!PUBLIC_EVENT_STATUSES.has(event.status ?? 'published')) return { robots: { index: false, follow: false } }")
    expect(read('app/api/events/[id]/route.ts')).toContain("if (!(await canSeeEvent(event, session))) return NextResponse.json({ error: 'Not found' }, { status: 404 })")
  })
})

describe('38. registration gives the same answer with or without an approved application', () => {
  it('no application answers like every other outcome', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).not.toContain('No approved application found')
    expect(src).toMatch(/if \(!application\) \{\s*return NextResponse\.json\(\{ pending: true, checkEmail: true \}\)/)
  })
})

describe('39. two-factor attempts are limited per account', () => {
  it('verify limits on the pending account as well as the IP', () => {
    const src = read('app/api/auth/2fa/verify/route.ts')
    expect(src).toContain('rateLimit(`2fa-user:${userId}`, 10, 15 * 60_000)')
    expect(src.indexOf('2fa-user:')).toBeLessThan(src.indexOf('const user = await prisma.user.findUnique'))
  })
})

describe('40. guide entries are scoped to the cities the editor may act in', () => {
  const get = () => guideEntriesGET(new Request('http://x/api/admin/guide-entries') as never)
  beforeEach(() => {
    p.city.findMany.mockResolvedValue([{ id: 'ist', slug: 'istanbul', name: 'Istanbul', status: 'live' }, { id: 'izm', slug: 'izmir', name: 'Izmir', status: 'live' }])
  })
  it('a moderator with no city chosen gets only their city\'s entries and cities', async () => {
    h.session = { id: 'm', role: 'moderator', cityId: 'izm' }
    const body = await (await get()).json()
    expect(p.guideEntry.findMany.mock.calls[0][0].where).toEqual({ kind: 'experience', cityId: { in: ['izm'] } })
    expect(body.cities.map((c: { id: string }) => c.id)).toEqual(['izm'])
  })
  it('an admin still gets every city', async () => {
    h.session = { id: 'a', role: 'admin' }
    await get()
    expect(p.guideEntry.findMany.mock.calls[0][0].where).toEqual({ kind: 'experience' })
  })
})
