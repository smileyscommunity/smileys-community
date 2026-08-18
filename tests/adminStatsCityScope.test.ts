import { describe, it, expect, vi, beforeEach } from 'vitest'

// The admin dashboard used to count every model network-wide: not one of the
// ~27 aggregates in /api/admin/stats mentioned a city. With one city live that
// was correct by accident. With two it is a number that looks authoritative
// and is not — Istanbul's mass hides whether a young city is working at all,
// and nobody reports a total that merely looks plausible.
//
// Most of these models have no cityId of their own and reach one through a
// relation (event, hangout, reported user), so the filter is easy to drop on
// exactly one query while the other twenty-six keep it. That failure is
// invisible in the response — a slightly-too-large count — which is why this
// pins the `where` arguments rather than the numbers that come back.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access',  () => ({ canViewAnalytics: () => true }))
vi.mock('@/lib/city',    () => ({ getCityTz: vi.fn(async () => 'Europe/Istanbul') }))
vi.mock('@/lib/cronHealth', () => ({ listStaleSweepers: vi.fn(async () => []) }))

// Built inside the factory: vi.mock is hoisted above every top-level const,
// so helpers declared out here are still in the temporal dead zone when it runs.
vi.mock('@/lib/prisma', () => {
  const count = () => vi.fn(async () => 0)
  const group = () => vi.fn(async () => [])
  const many  = () => vi.fn(async () => [])
  return { prisma: {
    city:                { findUnique: vi.fn() },
    user:                { count: count(), findUnique: vi.fn(async () => null) },
    event:               { count: count(), findMany: many() },
    eventAttendee:       { count: count(), groupBy: group() },
    eventSurvey:         { count: count() },
    clubMembership:      { groupBy: group() },
    memberApplication:   { count: count() },
    report:              { count: count() },
    payment:             { groupBy: group() },
    hangout:             { count: count(), groupBy: group() },
    hangoutReference:    { count: count() },
    visitorAnnouncement: { count: count() },
    emailFailure:        { count: count() },
  } }
})

import { GET } from '@/app/api/admin/stats/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const CITY = { id: 'c-bodrum', name: 'Bodrum', slug: 'bodrum' }

// Every model whose rows belong to a city, and therefore must narrow. Left
// out on purpose: emailFailure (SMTP health is platform-wide, not per-city)
// and city itself (that's the lookup of the filter, not a filtered read).
const CITY_SCOPED = [
  'user', 'event', 'eventAttendee', 'eventSurvey', 'clubMembership',
  'memberApplication', 'report', 'payment', 'hangout', 'hangoutReference',
  'visitorAnnouncement',
] as const

// Collect the `where` of every aggregate call made against city-scoped
// models. findUnique is excluded — those are id lookups (the top hangout
// host), not aggregates that could over-count.
function aggregateCalls() {
  const out: { label: string; where: unknown }[] = []
  for (const model of CITY_SCOPED) {
    for (const method of ['count', 'groupBy', 'findMany'] as const) {
      const fn = (prisma as any)[model]?.[method]
      if (!fn?.mock) continue
      fn.mock.calls.forEach((c: any[], i: number) => {
        out.push({ label: `${model}.${method}#${i}`, where: c[0]?.where })
      })
    }
  }
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', role: 'admin', cityId: 'c-istanbul' })
  ;(prisma.city.findUnique as any).mockResolvedValue(CITY)
})

describe('admin dashboard stats — city scope', () => {
  it('narrows every city-scoped aggregate when ?city= is given', async () => {
    await GET(new Request('https://x/app/api/admin/stats?city=c-bodrum'))

    const calls = aggregateCalls()
    // Guard the guard: if the route is refactored into fewer queries this
    // test must not quietly start asserting nothing.
    expect(calls.length).toBeGreaterThan(20)

    const unscoped = calls.filter(c => !JSON.stringify(c.where ?? {}).includes('c-bodrum'))
    expect(unscoped.map(c => c.label)).toEqual([])
  })

  it('leaves platform-wide health alone — SMTP has no city', async () => {
    await GET(new Request('https://x/app/api/admin/stats?city=c-bodrum'))
    const where = (prisma.emailFailure.count as any).mock.calls[0][0].where
    expect(JSON.stringify(where)).not.toContain('c-bodrum')
  })

  it('counts network-wide when no city is given', async () => {
    await GET(new Request('https://x/app/api/admin/stats'))
    expect(prisma.city.findUnique).not.toHaveBeenCalled()
    const scoped = aggregateCalls().filter(c => JSON.stringify(c.where ?? {}).includes('cityId'))
    expect(scoped.map(c => c.label)).toEqual([])
  })

  it('rejects an unknown city instead of silently showing everything', async () => {
    ;(prisma.city.findUnique as any).mockResolvedValue(null)
    const res = await GET(new Request('https://x/app/api/admin/stats?city=nope'))
    expect(res.status).toBe(400)
    // Nothing counted — a bad id must not fall through to a network-wide read
    // that the UI would then label "Bodrum".
    expect(prisma.user.count).not.toHaveBeenCalled()
  })

  it('reports which city the numbers describe', async () => {
    const res  = await GET(new Request('https://x/app/api/admin/stats?city=c-bodrum'))
    const body = await res.json()
    expect(body.city).toEqual(CITY)

    const plain = await (await GET(new Request('https://x/app/api/admin/stats'))).json()
    expect(plain.city).toBeNull()
  })
})
