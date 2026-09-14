import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Scan 5, item 91: the board / directory / neighborhood tail — stale results
// from overlapping fetches, hangout join counts, the wall's hover-only reply
// delete, the neighborhoods map resetting on every keystroke, and moving-sale
// dates judged on the UTC day instead of the posting city's.
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

const p = vi.hoisted(() => ({
  movingSale:     { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  movingSaleItem: { updateMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  user:           { findMany: vi.fn() },
  $transaction:   vi.fn(),
}))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const tz = vi.hoisted(() => ({ byCity: {} as Record<string, string> }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/city', () => ({
  resolveCityId: vi.fn(async () => 'cookie-city'),
  getCityTz:     vi.fn(async (cityId: string) => tz.byCity[cityId] ?? 'Europe/Istanbul'),
}))
vi.mock('@/lib/cities', () => ({ getPublicCity: vi.fn(async () => null) }))
vi.mock('@/lib/cityMembership', () => ({ resolvePostingCityId: vi.fn(async () => 'tokyo-id') }))
vi.mock('@/lib/neighborhoodsDb', () => ({ safeNeighborhoodFor: vi.fn(async () => null) }))
vi.mock('@/lib/authorProjection', () => ({ authorProjector: vi.fn(async () => (u: unknown) => u) }))
vi.mock('@/lib/email', () => ({ sendListingAlertEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn() }))

import { POST as salePOST } from '@/app/api/moving-sales/route'
import { PATCH as salePATCH } from '@/app/api/moving-sales/[id]/route'
import { getCityTz } from '@/lib/city'
import { resolvePostingCityId } from '@/lib/cityMembership'

// 20:30 UTC on 14 Sep: already 15 Sep in Tokyo (UTC+9), still 14 Sep in New York.
const NOW = new Date('2026-09-14T20:30:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  session.current = { id: 'seller', name: 'Seller', role: 'member', cityId: 'tokyo-id' }
  tz.byCity = { 'tokyo-id': 'Asia/Tokyo', 'nyc-id': 'America/New_York' }
  p.movingSale.create.mockResolvedValue({ id: 's1', cityId: 'tokyo-id' })
  p.movingSale.update.mockResolvedValue({ id: 's1' })
  p.user.findMany.mockResolvedValue([])
  p.$transaction.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers() })

describe('91e moving-sale POST judges "past" in the posting city', () => {
  const post = (body: Record<string, unknown>) => salePOST({ json: async () => body } as never)
  const items = [{ name: 'Desk', price: '' }]

  it("refuses a date that has already ended in the posting city, even while it's still that day in UTC", async () => {
    const res = await post({ leavingOn: '2026-09-14', items })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Leaving date is in the past')
    expect(getCityTz).toHaveBeenCalledWith('tokyo-id')
    expect(p.movingSale.create).not.toHaveBeenCalled()
  })

  it("accepts the posting city's today", async () => {
    const res = await post({ leavingOn: '2026-09-15', items })
    expect(res.status).toBe(201)
  })

  it("accepts today west of UTC after UTC's midnight has passed", async () => {
    vi.setSystemTime(new Date('2026-09-15T02:00:00Z')) // 22:00 on 14 Sep in New York
    vi.mocked(resolvePostingCityId).mockResolvedValueOnce('nyc-id')
    p.movingSale.create.mockResolvedValueOnce({ id: 's2', cityId: 'nyc-id' })
    const res = await post({ leavingOn: '2026-09-14', items })
    expect(res.status).toBe(201)
    expect(p.movingSale.create.mock.calls[0][0].data).toMatchObject({ cityId: 'nyc-id', leavingOn: '2026-09-14' })
  })
})

describe("91e moving-sale PATCH holds a changed date to the sale city's today", () => {
  const patch = (body: Record<string, unknown>) =>
    salePATCH({ json: async () => body } as never, { params: Promise.resolve({ id: 's1' }) })

  beforeEach(() => {
    p.movingSale.findUnique.mockResolvedValue({ userId: 'seller', cityId: 'tokyo-id', leavingOn: '2026-09-20' })
  })

  it("refuses moving the date to one already over in the sale's city", async () => {
    const res = await patch({ leavingOn: '2026-09-14' })
    expect(res.status).toBe(400)
    expect(getCityTz).toHaveBeenCalledWith('tokyo-id')
    expect(p.movingSale.update).not.toHaveBeenCalled()
  })

  it("accepts the sale city's today", async () => {
    const res = await patch({ leavingOn: '2026-09-15' })
    expect(res.status).toBe(200)
    expect(p.movingSale.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { leavingOn: '2026-09-15' } })
  })

  it('still saves an edit that resends an unchanged, already-passed date', async () => {
    p.movingSale.findUnique.mockResolvedValue({ userId: 'seller', cityId: 'tokyo-id', leavingOn: '2026-09-01' })
    const res = await patch({ leavingOn: '2026-09-01', note: 'typo fixed' })
    expect(res.status).toBe(200)
    expect(p.movingSale.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { leavingOn: '2026-09-01', note: 'typo fixed' } })
  })
})

// ── Client source pins (vitest has no JSX transform for .tsx) ────────────────

describe('91e moving-sale date picker floor', () => {
  const sales = read('components/MovingSales.tsx')
  it("uses the posting city's calendar day, never the UTC day", () => {
    expect(sales).not.toContain('toISOString()')
    expect(sales).toContain('min={minLeavingOn}')
    expect(sales).toMatch(/const minLeavingOn = todayInTz\(\(postingIsCurrent \? current\?\.timezone : postingTz\) \?\? current\?\.timezone \?\? DEFAULT_TZ\)/)
    expect(sales).toContain('fetch(`/app/api/city/current?city=${encodeURIComponent(postingSlug)}`')
  })
})

describe('91a overlapping list fetches drop stale answers', () => {
  it('directory list load is sequenced like BoardHub', () => {
    const src = read('app/directory/DirectoryClient.tsx')
    const load = src.slice(src.indexOf('const load = useCallback('), src.indexOf('useEffect(() => { load() }, [load])'))
    expect(load).toMatch(/const seq = \+\+loadSeq\.current/)
    expect(load.indexOf('if (!isCurrent()) return')).toBeGreaterThan(-1)
    expect(load.indexOf('if (!isCurrent()) return')).toBeLessThan(load.indexOf('setBusinesses(items)'))
    expect(load).toMatch(/\.catch\(\(\) => \{ if \(isCurrent\(\)\) \{ setBusinesses\(\[\]\); setTotal\(0\) \} \}\)/)
    expect(load).toMatch(/\.finally\(\(\) => \{ if \(isCurrent\(\)\) setLoading\(false\) \}\)/)
    expect(src).toMatch(/if \(!cancelled && d\?\.slug\) setViewCity\(d\)/)
  })

  it('moving sales list and the marketplace preview are sequenced', () => {
    const sales = read('components/MovingSales.tsx')
    expect(sales).toMatch(/const seq = \+\+loadSeq\.current[\s\S]{0,300}if \(seq !== loadSeq\.current\) return\n\s*setSales\(data\.sales \?\? \[\]\)/)
    const hub = read('components/BoardHub.tsx')
    expect(hub).toMatch(/const seq = \+\+movingPreviewSeq\.current/)
    expect(hub).toContain('if (seq === movingPreviewSeq.current) setMovingPreview(')
  })

  it('the neighborhood wall ignores a previous slug\'s answer', () => {
    const wall = read('components/NeighborhoodWall.tsx')
    expect(wall).toMatch(/\.then\(d => \{ if \(!cancelled && Array\.isArray\(d\)\) setPosts\(d\) \}\)/)
    expect(wall).toMatch(/return \(\) => \{ cancelled = true \}\n\s*\}, \[slug\]\)/)
  })

  it('BoardFeed / BoardHub listings keep their existing guards', () => {
    expect(read('components/BoardFeed.tsx')).toMatch(/const seq = append \? loadSeq\.current : \+\+loadSeq\.current/)
    expect(read('components/BoardHub.tsx')).toMatch(/const seq = \+\+loadSeq\.current/)
  })
})

describe('91b board hangout cards show their join count', () => {
  it('BoardFeed counts the field the hangouts API actually returns', () => {
    expect(read('app/api/hangouts/route.ts')).toMatch(/joiners:\s+h\.joins\.map\(j => j\.user\)/)
    const feed = read('components/BoardFeed.tsx')
    expect(feed).toContain('joinCount: h.joiners?.length ?? 0')
    expect(feed).not.toMatch(/h\.joins\?\.length/)
    expect(feed).toMatch(/\{h\.joinCount > 0 && <> · 👥 \{h\.joinCount\} joined<\/>\}/)
  })
})

describe('91c wall reply delete is reachable without hover', () => {
  const wall = read('components/NeighborhoodWall.tsx')
  const btn = wall.slice(wall.indexOf('onClick={() => deleteReply(r.id)}'), wall.indexOf('</button>', wall.indexOf('onClick={() => deleteReply(r.id)}')))
  it('is visible by default and only hover-hidden on wide, hover-capable screens', () => {
    expect(btn).toContain('aria-label="Delete reply"')
    expect(btn).not.toMatch(/(^|\s)opacity-0(\s|")/)
    expect(btn).toContain('opacity-100 [@media(min-width:640px)_and_(hover:hover)]:opacity-0')
    expect(btn).toContain('group-hover:opacity-100')
    expect(btn).toContain('focus-visible:opacity-100')
  })
})

describe('91d neighborhoods map keeps its pan/zoom', () => {
  const map = read('components/NeighborhoodsMapView.tsx')
  it('creates the Leaflet map once, not per points/center identity', () => {
    const init = map.slice(map.indexOf("import('leaflet').then"), map.indexOf('useEffect(', map.indexOf("import('leaflet').then")))
    expect(init).toContain('L.map(containerRef.current)')
    expect(init).toMatch(/\}, \[\]\)\s*$/)
    expect(map).not.toMatch(/\}, \[points, center\]\)/)
  })
  it('redraws markers on content change and frames only on first draw or a new city', () => {
    expect(map).toMatch(/\}, \[mapGen, pointsKey, centerKey\]\)/)
    expect(map).toMatch(/if \(framedFor\.current !== centerKey\) \{\s*framedFor\.current = centerKey\s*if \(markers\.length > 0\) map\.fitBounds/)
    expect(map.match(/fitBounds\(/g)).toHaveLength(1)
    expect(map).toContain('layer.clearLayers()')
  })
})
