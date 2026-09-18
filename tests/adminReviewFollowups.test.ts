import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Follow-ups to the admin-panel review fixes: the fixes themselves must not
// lock staff out of what they legitimately do. A moderator still saves
// application notes and writes city articles, a host from another city who
// hosts the club still hosts its events, a moderator still reviews the rooms
// they run in other cities — and the masking must not garble dates.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user:           { findUnique: vi.fn() },
    clubMembership: { findFirst: vi.fn(async () => null) },
    cityHost:       { findFirst: vi.fn(async () => null) },
  },
}))

import { prisma } from '@/lib/prisma'
import { hostIdError } from '@/lib/eventHostCheck'
import { maskContactsIn } from '@/lib/admin/maskContact'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const mod   = { id: 'mod', name: 'M', email: 'm@x', role: 'moderator', color: '#000', cityId: 'bursa' } as never
const admin = { id: 'adm', name: 'A', email: 'a@x', role: 'admin',     color: '#000', cityId: 'istanbul' } as never

describe('event host check', () => {
  beforeEach(() => vi.clearAllMocks())
  const live = (cityId: string) => ({ status: 'approved', suspendedUntil: null, cityId })

  it('a member of the event\'s city can host', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(live('bursa'))
    expect(await hostIdError('h1', 'bursa', mod, 'club1')).toBeNull()
  })

  it('a host of the club, living elsewhere, can host its events', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(live('istanbul'))
    ;(prisma.clubMembership.findFirst as any).mockResolvedValueOnce({ userId: 'h1' })
    expect(await hostIdError('h1', 'bursa', mod, 'club1')).toBeNull()
  })

  it('a city host of the city can host', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(live('istanbul'))
    ;(prisma.cityHost.findFirst as any).mockResolvedValueOnce({ id: 'ch' })
    expect(await hostIdError('h1', 'bursa', mod, 'club1')).toBeNull()
  })

  it('anyone else from another city can\'t, unless an admin chose them', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(live('istanbul'))
    expect(await hostIdError('h1', 'bursa', mod, 'club1')).toMatch(/city/)
    expect(await hostIdError('h1', 'bursa', admin, 'club1')).toBeNull()
  })

  it('a banned, pending or suspended account never hosts', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ status: 'banned', suspendedUntil: null, cityId: 'bursa' })
    expect(await hostIdError('h1', 'bursa', admin)).not.toBeNull()
    ;(prisma.user.findUnique as any).mockResolvedValue({ status: 'approved', suspendedUntil: new Date(Date.now() + 86_400_000), cityId: 'bursa' })
    expect(await hostIdError('h1', 'bursa', admin)).toMatch(/suspended/)
  })

  it('a moderator can hand a joined event to someone else, not to themselves', () => {
    const s = src('app/api/admin/events/[id]/route.ts')
    expect(s).toContain("if (!isAdmin(session) && rest.hostId === session.id) {")
  })
})

describe('masking contact details in audit text', () => {
  it('masks emails and phone numbers, not dates', () => {
    const out = maskContactsIn(mod, 'Blacklisted ayse@example.com / +90 555 111 22 33 until 2026-09-25 (7 days), event (2026-09-19, 19:00)')!
    expect(out).not.toContain('ayse@example.com')
    expect(out).not.toContain('555 111 22 33')
    expect(out).toContain('2026-09-25 (7 days)')
    expect(out).toContain('(2026-09-19, 19:00)')
  })
  it('leaves an admin\'s view untouched', () => {
    expect(maskContactsIn(admin, 'ayse@example.com')).toBe('ayse@example.com')
  })
})

describe('staff are not locked out', () => {
  it('a moderator reviews their city\'s rooms and the ones they run anywhere', () => {
    const lib = src('lib/attendanceReview.ts')
    expect(lib).toContain('events = events.filter(e => allowed.has(e.id) || (cityId !== undefined && e.cityId === cityId))')
    const route = src('app/api/attendance-review/route.ts')
    expect(route).toContain('if (!admin) {')
    expect(route).toContain('attendanceReviewRows(new Date(), eventIds, all && !admin ? failClosedCityId(session) : undefined)')
  })

  it('a moderator can still save an application note', () => {
    expect(src('app/api/admin/applications/route.ts')).toContain('if (reviewNote !== undefined && assignedClubs === undefined) {')
  })

  it('a moderator\'s article defaults to their own city', () => {
    expect(src('app/api/admin/posts/route.ts')).toContain('if (!cityId && !country && !isAdmin(session) && session.cityId) postCityId = session.cityId')
  })

  it('rate limits are spent only on requests that go ahead', () => {
    const b = src('app/api/admin/notifications/broadcast/route.ts')
    expect(b.indexOf('claimOnce(claimKey')).toBeLessThan(b.indexOf("rateLimit(`broadcast-mod:"))
    const u = src('app/api/admin/users/[id]/route.ts')
    expect(u.indexOf('claimOnce(claimKey, REENGAGE_DEDUPE_MS)')).toBeLessThan(u.indexOf('rateLimit(`reengage-send:'))
  })

  it('a newsletter\'s claim is handed back when the database fails before any email', () => {
    const s = src('app/api/admin/newsletter/route.ts')
    expect(s.match(/await releaseClaim\(claimKey\)\n\s*return NextResponse\.json\(\{ error: 'Couldn\\'t/g)?.length).toBe(2)
  })
})
