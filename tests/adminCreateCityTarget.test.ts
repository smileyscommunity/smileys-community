import { describe, it, expect, vi, beforeEach } from 'vitest'

// Every admin create path used to hardcode the creator's own city, which made
// standing up a second city impossible through the panel: an Istanbul admin
// creating "Bodrum Beach Club" got an Istanbul club, silently. Bodrum's first
// three clubs had to be seeded by script because of exactly this.
//
// resolveTargetCityId is the one place the rule lives now: an explicit cityId
// must exist and pass canActInCity (admins anywhere, moderators only at home);
// omitted falls back to the creator's own context. The dangerous regression is
// the 403 arm — if it stops firing, a Bodrum moderator can plant records in
// Istanbul, and nothing in the response would look wrong.

vi.mock('@/lib/prisma', () => ({
  prisma: { city: { findUnique: vi.fn(), findFirst: vi.fn() } },
}))
// getViewCityId reads cookies() — outside a request scope it already returns
// null, but mock it so the test doesn't depend on that fallback behavior.
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))

import { resolveTargetCityId } from '@/lib/city'
import { prisma } from '@/lib/prisma'

const admin = { id: 'a1', name: 'A', email: 'a@x', role: 'admin' as const,     status: 'approved', tokenVersion: 1, cityId: 'c-ist' }
const mod   = { id: 'm1', name: 'M', email: 'm@x', role: 'moderator' as const, status: 'approved', tokenVersion: 1, cityId: 'c-ist' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.city.findUnique as any).mockImplementation(async ({ where }: any) =>
    ['c-ist', 'c-bod'].includes(where.id) ? { id: where.id } : null)
})

describe('resolveTargetCityId', () => {
  it('admin lands a create in any existing city', async () => {
    expect(await resolveTargetCityId(admin as any, 'c-bod')).toEqual({ cityId: 'c-bod' })
  })

  it('moderator may create in their own city', async () => {
    expect(await resolveTargetCityId(mod as any, 'c-ist')).toEqual({ cityId: 'c-ist' })
  })

  it('moderator creating in another city is refused, not redirected', async () => {
    const r = await resolveTargetCityId(mod as any, 'c-bod')
    expect(r).toEqual({ error: 'Cross-city create is admin-only', status: 403 })
  })

  it('unknown city is a 400, not a fallthrough to the default city', async () => {
    const r = await resolveTargetCityId(admin as any, 'c-nope')
    expect(r).toEqual({ error: 'Unknown city', status: 400 })
  })

  it('non-string cityId is rejected before it reaches the DB', async () => {
    const r = await resolveTargetCityId(admin as any, { id: 'c-bod' })
    expect(r).toEqual({ error: 'cityId must be a string', status: 400 })
    expect(prisma.city.findUnique).not.toHaveBeenCalled()
  })

  it("omitted ('' / undefined / null) falls back to the creator's own city", async () => {
    for (const empty of ['', undefined, null]) {
      expect(await resolveTargetCityId(admin as any, empty)).toEqual({ cityId: 'c-ist' })
    }
    // Fallback never consults canActInCity against a *requested* city, so it
    // must not have looked any city up by request either.
    expect(prisma.city.findUnique).not.toHaveBeenCalled()
  })
})
