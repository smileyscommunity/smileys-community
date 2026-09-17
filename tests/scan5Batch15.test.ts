import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'

// Scan 5, batch 15.
//
// 55 — a shared phone kept the previous member's pushes. Three halves had to
//      move together: the subscribe route now MOVES an endpoint owned by
//      someone else to the caller (it was a silent no-op), logout removes the
//      device's subscription while the cookie still authorizes it, and the
//      prompt's once-a-day re-sync is stamped per member.
// 60 — "Visitor coming to <neighborhood>" skipped the block list that every
//      other neighborhood fan-out honours, in both directions.

const read = (p: string) => readFileSync(p, 'utf-8')

const session = vi.hoisted(() => ({ current: null as null | { id: string; name?: string } }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true), getIp: vi.fn(() => '1.2.3.4') }))
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: vi.fn(async () => true) }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/city', () => ({ resolveCityId: vi.fn(async () => 'c-ist'), todayInCity: vi.fn(async () => '2026-09-01'), DEFAULT_CITY_SLUG: 'istanbul' }))
vi.mock('@/lib/cities', () => ({ resolvePublicCityIdFromSlug: vi.fn(async () => 'c-ist') }))
vi.mock('@/lib/neighborhoodsDb', () => ({ safeNeighborhoodFor: vi.fn(async (_c: string, n: unknown) => (typeof n === 'string' ? n : null)) }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    pushSubscription:    { findUnique: vi.fn(), upsert: vi.fn(async () => ({})), findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({})) },
    city:                { findUnique: vi.fn() },
    visitorAnnouncement: { findFirst: vi.fn(async () => null), create: vi.fn() },
    memberBlock:         { findMany: vi.fn(async () => []) },
    user:                { findMany: vi.fn(async () => []) },
  },
}))

import { POST as subscribePOST } from '@/app/api/push/subscribe/route'
import { POST as visitorsPOST } from '@/app/api/visitors/route'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'

const p = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  session.current = { id: 'u-b', name: 'Bea' }
})

describe('55a push subscribe: an endpoint owned by another member moves to the caller', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/device-123'
  const keys = { p256dh: 'p'.repeat(40), auth: 'a'.repeat(22) }
  const call = () => subscribePOST(new Request('https://x/app/api/push/subscribe', {
    method: 'POST', body: JSON.stringify({ endpoint, keys }),
  }) as never)

  it('rewrites userId (and keys) instead of answering ok and changing nothing', async () => {
    p.pushSubscription.findUnique.mockResolvedValue({ id: 's1', userId: 'u-a', endpoint })
    const res = await call()
    expect(res.status).toBe(200)
    expect(p.pushSubscription.upsert).toHaveBeenCalledTimes(1)
    const arg = p.pushSubscription.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ endpoint })
    expect(arg.update).toMatchObject({ userId: 'u-b', p256dh: keys.p256dh, auth: keys.auth })
    // Newest-first cap and send ordering must not evict the row it just moved.
    expect(arg.update.createdAt).toBeInstanceOf(Date)
    // The per-user cap still runs, for the NEW owner.
    expect(p.pushSubscription.findMany.mock.calls[0][0].where).toEqual({ userId: 'u-b' })
  })

  it('still refuses an endpoint outside the push-service allowlist', async () => {
    const res = await subscribePOST(new Request('https://x/app/api/push/subscribe', {
      method: 'POST', body: JSON.stringify({ endpoint: 'https://evil.example/push', keys }),
    }) as never)
    expect(res.status).toBe(400)
    expect(p.pushSubscription.upsert).not.toHaveBeenCalled()
  })
})

describe('55b logout removes this device\'s push subscription first', () => {
  const ctx = read('contexts/AuthContext.tsx')
  const lib = read('lib/pushDevice.ts')
  it('forgets the device before the logout request drops the cookie', () => {
    expect(ctx).toMatch(/async function logout\(\) \{[\s\S]*?await forgetPushDevice\(\)\s*await fetch\('\/app\/api\/auth\/logout'/)
  })
  it('DELETEs the endpoint, unsubscribes locally, and cannot hang or throw', () => {
    expect(lib).toMatch(/!\('serviceWorker' in navigator\)\) return/)
    // getRegistration, never .ready (which never settles without a worker).
    expect(lib).toContain('navigator.serviceWorker.getRegistration()')
    expect(lib).not.toContain('serviceWorker.ready')
    expect(lib).toMatch(/fetch\('\/app\/api\/push\/subscribe', \{\s*method: 'DELETE'[\s\S]*?JSON\.stringify\(\{ endpoint: sub\.endpoint \}\)[\s\S]*?\}\)\.catch\(\(\) => \{\}\)/)
    expect(lib).toMatch(/await sub\.unsubscribe\(\)\.catch\(/)
    expect(lib).toMatch(/localStorage\.removeItem\(PUSH_SYNCED_USER_KEY\)/)
  })
})

describe('55c push prompt re-syncs per member', () => {
  const src = read('components/PushPermission.tsx')
  it('re-syncs immediately when the signed-in member is not the one last synced', () => {
    expect(src).toMatch(/const \{ user \} = useAuth\(\)/)
    expect(src).toMatch(/syncedUser\(\) !== userId \|\| Date\.now\(\) - readStamp\(SYNCED_KEY\) > RESYNC_AFTER/)
    expect(src).toMatch(/if \(r === 'ok'\) \{ rememberSyncedUser\(userId\); writeStamp\(SYNCED_KEY\) \}/)
    expect(src).toMatch(/if \(result === 'ok'\) \{\s*writeStamp\(SYNCED_KEY\)\s*setState\('subscribed'\)\s*rememberSyncedUser\(userId\)/)
    expect(src).toMatch(/\}, \[userId\]\)/)
  })
  it('keeps the refused-endpoint back-off', () => {
    expect(src).toMatch(/if \(due && Date\.now\(\) - readStamp\(REFUSED_KEY\) > REFUSED_FOR\)/)
  })
})

describe('60 visitor announcement ping skips blocked pairs and other cities', () => {
  const call = (body: Record<string, unknown> = {}) => visitorsPOST(new Request('https://x/app/api/visitors', {
    method: 'POST',
    body: JSON.stringify({ name: 'Vera Visitor', intro: 'Hi', startsOn: '2026-09-10', endsOn: '2026-09-12', neighborhood: 'Moda', city: 'istanbul', ...body }),
  }) as never)

  // One population across two cities with a same-named neighborhood; the
  // mock applies the route's own where clause, so a dropped cityId shows up.
  const users = [
    { id: 'u-ok',      neighborhood: 'Moda', status: 'approved', hiddenFromMembers: false, cityId: 'c-ist' },
    { id: 'u-blocker', neighborhood: 'Moda', status: 'approved', hiddenFromMembers: false, cityId: 'c-ist' },  // blocked the visitor
    { id: 'u-blocked', neighborhood: 'Moda', status: 'approved', hiddenFromMembers: false, cityId: 'c-ist' },  // visitor blocked them
    { id: 'u-izmir',   neighborhood: 'Moda', status: 'approved', hiddenFromMembers: false, cityId: 'c-izm' },
  ]

  beforeEach(() => {
    session.current = { id: 'u-vis', name: 'Vera' }
    p.city.findUnique.mockResolvedValue({ id: 'c-ist', slug: 'istanbul', status: 'live' })
    p.visitorAnnouncement.create.mockImplementation(async ({ data }: any) => ({ id: 'va1', ...data }))
    p.user.findMany.mockImplementation(async ({ where }: any) =>
      users.filter(u => Object.entries(where).every(([k, v]) => (u as any)[k] === v)).map(u => ({ id: u.id })))
    p.memberBlock.findMany.mockImplementation(async ({ where }: any) => {
      const rows = [
        { blockerId: 'u-blocker', blockedId: 'u-vis' },
        { blockerId: 'u-vis',     blockedId: 'u-blocked' },
        { blockerId: 'u-x',       blockedId: 'u-ok' },  // unrelated pair
      ]
      return rows.filter(r => where.OR.some((c: any) => Object.entries(c).every(([k, v]) => (r as any)[k] === v)))
    })
  })

  const notified = () => (createNotification as any).mock.calls.map((c: any[]) => c[0]).sort()

  it('notifies the unblocked local only — not either side of a block, not another city\'s Moda', async () => {
    const res = await call()
    expect(res.status).toBe(201)
    await vi.waitFor(() => expect(createNotification).toHaveBeenCalled())
    expect(notified()).toEqual(['u-ok'])
    expect(p.user.findMany.mock.calls[0][0].where).toMatchObject({ cityId: 'c-ist', neighborhood: 'Moda' })
  })

  it('a visitor without an account cannot post — the API took what the form no longer offered', async () => {
    session.current = null
    const res = await call()
    expect(res.status).toBe(401)
    expect(notified()).toEqual([])
    expect(p.visitorAnnouncement.create).not.toHaveBeenCalled()
  })
})
