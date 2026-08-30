import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB so we test only the authority cascade, not Prisma.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    city:     { findUnique: vi.fn(), findMany: vi.fn() },
    cityHost: { findUnique: vi.fn(), findMany: vi.fn() },
    clubMembership: { findUnique: vi.fn(), count: vi.fn() },
  },
}))

import { isCityConsul, isCityHost, hostCityIds, canHostInCity } from '@/lib/access'
import {
  isCityHostSomewhere, hasHostAuthority, canEnterHostPanel, canHostEvents, canHostClubs,
  type AppUser,
} from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/session'

const session = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: 'u1', name: 'U', email: 'u@example.com', role: 'member', color: '#000', ...over,
})

// Client-side viewer, as /api/auth/me ships it.
const viewer = (over: Partial<AppUser> = {}): AppUser => ({
  id: 'u1', name: 'U', initials: 'U', color: '#000', role: 'member', ...over,
})

// No consul, no grant, no club host — the default for every test.
beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.city.findUnique     as any).mockResolvedValue({ consulUserId: null })
  ;(prisma.city.findMany       as any).mockResolvedValue([])
  ;(prisma.cityHost.findUnique as any).mockResolvedValue(null)
  ;(prisma.cityHost.findMany   as any).mockResolvedValue([])
  ;(prisma.clubMembership.findUnique as any).mockResolvedValue(null)
})

describe('isCityConsul', () => {
  it('is true only for the city’s appointed consul', async () => {
    ;(prisma.city.findUnique as any).mockResolvedValue({ consulUserId: 'u1' })
    expect(await isCityConsul('u1', 'bodrum')).toBe(true)
    expect(await isCityConsul('u2', 'bodrum')).toBe(false)
  })

  it('is false when the city has no consul, or does not exist', async () => {
    expect(await isCityConsul('u1', 'bodrum')).toBe(false)
    ;(prisma.city.findUnique as any).mockResolvedValue(null)
    expect(await isCityConsul('u1', 'nope')).toBe(false)
  })
})

describe('isCityHost', () => {
  it('accepts a live approved grant', async () => {
    ;(prisma.cityHost.findUnique as any).mockResolvedValue({ status: 'approved', revokedAt: null })
    expect(await isCityHost('u1', 'bodrum')).toBe(true)
  })

  // Revoking a grant stamps revokedAt and leaves status='approved' (the row is
  // kept as a record), so a status-only check would keep honouring it.
  it('rejects a revoked grant even though its status is still approved', async () => {
    ;(prisma.cityHost.findUnique as any).mockResolvedValue({
      status: 'approved', revokedAt: new Date('2026-08-01'),
    })
    expect(await isCityHost('u1', 'bodrum')).toBe(false)
  })

  it('rejects a pending grant and a missing row', async () => {
    ;(prisma.cityHost.findUnique as any).mockResolvedValue({ status: 'pending', revokedAt: null })
    expect(await isCityHost('u1', 'bodrum')).toBe(false)
    ;(prisma.cityHost.findUnique as any).mockResolvedValue(null)
    expect(await isCityHost('u1', 'bodrum')).toBe(false)
  })
})

describe('hostCityIds', () => {
  it('is empty for a member with no city authority', async () => {
    expect(await hostCityIds('u1')).toEqual([])
  })

  it('includes cities held as consul', async () => {
    ;(prisma.city.findMany as any).mockResolvedValue([{ id: 'bodrum' }])
    expect(await hostCityIds('u1')).toEqual(['bodrum'])
  })

  it('includes cities held by grant', async () => {
    ;(prisma.cityHost.findMany as any).mockResolvedValue([{ cityId: 'bodrum' }])
    expect(await hostCityIds('u1')).toEqual(['bodrum'])
  })

  it('unions both layers without duplicating a city held twice', async () => {
    ;(prisma.city.findMany     as any).mockResolvedValue([{ id: 'bodrum' }])
    ;(prisma.cityHost.findMany as any).mockResolvedValue([{ cityId: 'bodrum' }, { cityId: 'izmir' }])
    expect((await hostCityIds('u1')).sort()).toEqual(['bodrum', 'izmir'])
  })

  it('only counts live approved grants', async () => {
    await hostCityIds('u1')
    expect(prisma.cityHost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'approved', revokedAt: null }),
      }),
    )
  })
})

describe('canHostInCity', () => {
  it('lets an admin host anywhere without touching the city tables', async () => {
    expect(await canHostInCity(session({ role: 'admin' }), 'bodrum')).toBe(true)
    expect(prisma.city.findUnique).not.toHaveBeenCalled()
    expect(prisma.cityHost.findUnique).not.toHaveBeenCalled()
  })

  it('lets the consul host in their city', async () => {
    ;(prisma.city.findUnique as any).mockResolvedValue({ consulUserId: 'u1' })
    expect(await canHostInCity(session(), 'bodrum')).toBe(true)
  })

  it('lets a granted city host host in that city', async () => {
    ;(prisma.cityHost.findUnique as any).mockResolvedValue({ status: 'approved', revokedAt: null })
    expect(await canHostInCity(session(), 'bodrum')).toBe(true)
  })

  it('refuses a plain member and a plain moderator', async () => {
    expect(await canHostInCity(session(), 'bodrum')).toBe(false)
    expect(await canHostInCity(session({ role: 'moderator', cityId: 'bodrum' }), 'bodrum')).toBe(false)
  })

  // The distinction the city roles exist for: running a club series is not
  // authority over city-wide programming.
  it('does not treat a club host as a city host', async () => {
    ;(prisma.clubMembership.findUnique as any).mockResolvedValue({ status: 'approved', role: 'host' })
    expect(await canHostInCity(session(), 'bodrum')).toBe(false)
  })
})

// ── The /host panel gates ──────────────────────────────────────────────────
// These are the checks that were stale: they knew about club hosts only, so
// the city-level roles could not reach the panel at all.

describe('canEnterHostPanel', () => {
  it('admits a club host, an admin and a moderator (unchanged)', () => {
    expect(canEnterHostPanel(viewer({ isClubHost: true }))).toBe(true)
    expect(canEnterHostPanel(viewer({ role: 'admin' }))).toBe(true)
    expect(canEnterHostPanel(viewer({ role: 'moderator' }))).toBe(true)
  })

  // Prod 2026-08-17: the appointed Bodrum consul is role=member, so the old
  // gate bounced them to /login.
  it('admits a member who holds city-level hosting authority', () => {
    expect(canEnterHostPanel(viewer({ hostCityIds: ['bodrum'] }))).toBe(true)
  })

  it('still turns away a plain member', () => {
    expect(canEnterHostPanel(viewer())).toBe(false)
    expect(canEnterHostPanel(viewer({ hostCityIds: [] }))).toBe(false)
    expect(canEnterHostPanel(viewer({ isClubHost: false }))).toBe(false)
  })

  it('turns away a partner', () => {
    expect(canEnterHostPanel(viewer({ role: 'partner' }))).toBe(false)
  })
})

describe('canHostEvents', () => {
  it('covers admins and club hosts (unchanged)', () => {
    expect(canHostEvents(viewer({ role: 'admin' }))).toBe(true)
    expect(canHostEvents(viewer({ isClubHost: true }))).toBe(true)
  })

  it('covers a city host, whatever their role', () => {
    expect(canHostEvents(viewer({ hostCityIds: ['bodrum'] }))).toBe(true)
    // Prod 2026-08-17: a moderator with an approved Bodrum grant reached the
    // panel on their role but got no events tool.
    expect(canHostEvents(viewer({ role: 'moderator', hostCityIds: ['bodrum'] }))).toBe(true)
  })

  it('does not hand the events tool to oversight roles alone', () => {
    expect(canHostEvents(viewer({ role: 'moderator' }))).toBe(false)
    expect(canHostEvents(viewer())).toBe(false)
  })
})

describe('canHostClubs', () => {
  // Club hosting is per-club; city authority is not a club grant, and the
  // clubs tool would be empty for someone who holds no club.
  it('is club-host/admin only — city authority buys nothing', () => {
    expect(canHostClubs(viewer({ isClubHost: true }))).toBe(true)
    expect(canHostClubs(viewer({ role: 'admin' }))).toBe(true)
    expect(canHostClubs(viewer({ hostCityIds: ['bodrum'] }))).toBe(false)
    expect(canHostClubs(viewer({ role: 'moderator' }))).toBe(false)
  })
})

describe('hasHostAuthority', () => {
  // Gates the "Host Panel" entry links (account menu, command palette) —
  // both of which knew club hosts only.
  it('is true for either kind of hosting authority', () => {
    expect(hasHostAuthority(viewer({ isClubHost: true }))).toBe(true)
    expect(hasHostAuthority(viewer({ hostCityIds: ['bodrum'] }))).toBe(true)
    expect(hasHostAuthority(viewer({ role: 'moderator', hostCityIds: ['bodrum'] }))).toBe(true)
  })

  // Oversight roles have their own panels; this is "runs something of theirs".
  it('is false for a bare admin, moderator or member', () => {
    expect(hasHostAuthority(viewer({ role: 'admin' }))).toBe(false)
    expect(hasHostAuthority(viewer({ role: 'moderator' }))).toBe(false)
    expect(hasHostAuthority(viewer())).toBe(false)
  })
})

describe('isCityHostSomewhere', () => {
  it('is a non-empty check over hostCityIds, absent field included', () => {
    expect(isCityHostSomewhere(viewer())).toBe(false)              // payload predates the field
    expect(isCityHostSomewhere(viewer({ hostCityIds: [] }))).toBe(false)
    expect(isCityHostSomewhere(viewer({ hostCityIds: ['izmir'] }))).toBe(true)
  })

  it('is not implied by club hosting or an oversight role', () => {
    expect(isCityHostSomewhere(viewer({ isClubHost: true }))).toBe(false)
    expect(isCityHostSomewhere(viewer({ role: 'admin' }))).toBe(false)
  })
})
