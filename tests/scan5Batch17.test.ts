import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 63–66: moving-sale photo uploads, moderator listing edits,
// sign-in returning people where they were, and moving sales following the
// city in the link.
const read = (f: string) => readFileSync(f, 'utf8')

const p = vi.hoisted(() => ({
  listing:    { findUnique: vi.fn(), update: vi.fn() },
  movingSale: { findMany: vi.fn() },
}))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/city', () => ({ resolveCityId: vi.fn(async () => 'cookie-city'), getCityTz: vi.fn(async () => 'Europe/Istanbul') }))
vi.mock('@/lib/cities', () => ({ getPublicCity: vi.fn(async (slug: string) => (slug === 'izmir' ? { id: 'izmir-id', slug: 'izmir' } : null)) }))
vi.mock('@/lib/cityMembership', () => ({ resolvePostingCityId: vi.fn(async () => 'home-city') }))
// The real rule, observable: the point is that the route defers to it.
vi.mock('@/lib/access', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/access')>()) }))
vi.mock('@/lib/neighborhoodsDb', () => ({ safeNeighborhoodFor: vi.fn(async (_c: string, n: unknown) => (typeof n === 'string' ? n : null)) }))
vi.mock('@/lib/listingsPublic', () => ({ redactListingForGuest: vi.fn((l: unknown) => l) }))
vi.mock('@/lib/authorProjection', () => ({ authorProjector: vi.fn(async () => (u: unknown) => u) }))
vi.mock('@/lib/email', () => ({ sendListingAlertEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn() }))

import { PATCH as listingPATCH } from '@/app/api/listings/[id]/route'
import { GET as movingGET } from '@/app/api/moving-sales/route'
import { getPublicCity } from '@/lib/cities'
import { safeReturnPath } from '@/lib/safeUrl'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'

beforeEach(() => {
  vi.clearAllMocks()
  session.current = null
  p.listing.findUnique.mockResolvedValue({ id: 'l1', userId: 'author', cityId: 'istanbul', status: 'active' })
  p.listing.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'l1', ...data }))
  p.movingSale.findMany.mockResolvedValue([])
})

describe('64. moderators edit listings in their own city', () => {
  const patch = (body: Record<string, unknown>) =>
    listingPATCH({ json: async () => body, url: 'http://x/app/api/listings/l1' } as never, { params: Promise.resolve({ id: 'l1' }) })
  const mod = (cityId: string) => ({ id: 'mod', name: 'Mod', role: 'moderator', cityId })

  it("a moderator in the listing's city can save an edit", async () => {
    session.current = mod('istanbul')
    const res = await patch({ title: 'Desk, fixed typo', description: 'Solid oak' })
    expect(res.status).toBe(200)
    expect(p.listing.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { title: 'Desk, fixed typo', description: 'Solid oak' } })
  })

  it('a moderator from another city gets a 403 that says why, and nothing is written', async () => {
    session.current = mod('izmir')
    const res = await patch({ title: 'Nope' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('You can only edit listings in your own city')
    expect(p.listing.update).not.toHaveBeenCalled()
  })

  it('a city moderator still cannot renew or change status — those stay owner/admin actions', async () => {
    session.current = mod('istanbul')
    expect((await patch({ renew: true })).status).toBe(403)
    expect((await patch({ status: 'deleted' })).status).toBe(403)
    expect(p.listing.update).not.toHaveBeenCalled()
  })

  it('the owner is unchanged: edits, renews and marks filled', async () => {
    session.current = { id: 'author', name: 'A', role: 'member', cityId: 'istanbul' }
    expect((await patch({ title: 'Mine' })).status).toBe(200)
    expect((await patch({ renew: true })).status).toBe(200)
    expect((await patch({ status: 'filled' })).status).toBe(200)
  })

  it('an admin is unchanged: edits and removes listings in any city', async () => {
    session.current = { id: 'adm', name: 'Adm', role: 'admin', cityId: 'izmir' }
    expect((await patch({ title: 'Staff edit' })).status).toBe(200)
    expect((await patch({ status: 'deleted' })).status).toBe(200)
  })

  it('another member is still refused', async () => {
    session.current = { id: 'someone', name: 'S', role: 'member', cityId: 'istanbul' }
    const res = await patch({ title: 'x' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Forbidden')
  })

  it('the edit button stays for moderators and shows the server message on failure', () => {
    const hub = read('components/BoardHub.tsx')
    expect(hub).toContain("const isStaff = isLoggedIn && (user.role === 'admin' || user.role === 'moderator')")
    expect(hub).toMatch(/toast\.error\(data\.error \?\? 'Could not save changes'\)/)
  })
})

describe('66. moving sales GET honours ?city=', () => {
  const where = () => p.movingSale.findMany.mock.calls[0][0].where

  it('a known slug scopes the list to that city', async () => {
    await movingGET(new Request('http://x/app/api/moving-sales?city=izmir') as never)
    expect(getPublicCity).toHaveBeenCalledWith('izmir')
    expect(where().cityId).toBe('izmir-id')
  })

  it('an unknown slug falls back to the viewer\'s city', async () => {
    await movingGET(new Request('http://x/app/api/moving-sales?city=atlantis') as never)
    expect(where().cityId).toBe('cookie-city')
  })

  it('no slug uses the viewer\'s city without a lookup', async () => {
    await movingGET(new Request('http://x/app/api/moving-sales') as never)
    expect(getPublicCity).not.toHaveBeenCalled()
    expect(where().cityId).toBe('cookie-city')
  })

  it('guests still get no neighborhood', async () => {
    p.movingSale.findMany.mockResolvedValue([{ id: 's1', neighborhood: 'Moda', user: { id: 'u1', name: 'A B' }, items: [] }])
    const { sales } = await (await movingGET(new Request('http://x/app/api/moving-sales?city=izmir') as never)).json()
    expect(sales[0].neighborhood).toBeNull()
  })
})

describe('66. moving sales clients carry the page city and the posting city', () => {
  const sales = read('components/MovingSales.tsx')
  const hub   = read('components/BoardHub.tsx')

  it('both fetches pass the page city', () => {
    expect(sales).toContain('fetch(`/app/api/moving-sales${city ? `?city=${encodeURIComponent(city)}` : \'\'}`')
    expect(sales).toMatch(/setSales\(data\.sales \?\? \[\]\)\n\s*\}, \[city\]\)/)
    expect(hub).toContain('fetch(`/app/api/moving-sales${pinnedCity ? `?city=${encodeURIComponent(pinnedCity)}` : \'\'}`')
    expect(hub).toMatch(/setMovingPreview\([^\n]*\n\s*\.catch\(\(\) => \{\}\)\n\s*\}, \[pinnedCity, view\]\)/)
    expect(hub).toContain('<MovingSales cityName={cityName} city={pinnedCity} />')
  })

  it('the form offers the posting city\'s neighborhoods and says where the sale goes', () => {
    expect(sales).toContain('useCityNeighborhoods(postingCity?.slug || city || undefined)')
    expect(sales).toContain("const postingElsewhere = !!postingCity && !!viewedSlug && postingCity.slug !== viewedSlug")
    expect(sales).toMatch(/\{postingElsewhere && postingCity && \(\s*<p[^>]*>\s*Your sale will be posted in <strong>\{postingCity\.name\}<\/strong>/)
  })

  it('a sale posted to another city is announced by name, not silently missing', () => {
    expect(sales).toContain('if (postingElsewhere && postingCity) toast.success(`Moving sale posted in ${postingCity.name}`')
  })
})

describe('63. moving-sale photo upload works for members', () => {
  const sales = read('components/MovingSales.tsx')

  it('uploads into listings/, which members may use and the sale POST accepts', () => {
    expect(sales).toContain("form.append('folder', 'listings')")
    expect(read('app/api/upload/route.ts')).toMatch(/const isMemberUpload = [^\n]*folder === 'listings'/)
    expect(isUploadedImageUrl('/app/api/files/listings/1700000000000-abcdef123456.jpg')).toBe(true)
    expect(read('app/api/moving-sales/route.ts')).toContain('isUploadedImageUrl(photo) ? photo : null')
  })

  it('shows the server\'s reason and resets the input after every attempt', () => {
    expect(sales).toContain("else toast.error(data.error ?? 'Could not upload photo')")
    expect(sales).toMatch(/\} finally \{\s*setUploading\(false\)[\s\S]{0,120}input\.value = ''\s*\}/)
  })
})

describe('65. sign-in returns people where they were', () => {
  const login = read('app/login/page.tsx')
  // Mirrors the page's resolution so the precedence and safety are exercised.
  const resolve = (qs: string) => {
    const sp = new URLSearchParams(qs)
    return safeReturnPath(sp.get('next') ?? sp.get('return') ?? sp.get('from'))
  }

  it('the login page reads `return` through the same safe-path check as next/from', () => {
    expect(login).toContain("safeReturnPath(searchParams.get('next') ?? searchParams.get('return') ?? searchParams.get('from'))")
    // Read nowhere else — no unchecked path to router.push.
    expect(login.match(/searchParams\.get\('return'\)/g)).toHaveLength(1)
  })

  it('an in-app return is honoured, an off-site one is dropped', () => {
    expect(resolve('return=/board/abc123')).toBe('/board/abc123')
    expect(resolve('return=/directory/submit')).toBe('/directory/submit')
    expect(resolve('return=https://evil.com')).toBeNull()
    expect(resolve('return=//evil.com')).toBeNull()
    expect(resolve('return=/login')).toBeNull()
  })

  it('the existing return= links are left as they were', () => {
    expect(read('components/DirectorySaveButton.tsx')).toContain('router.push(`/login?return=/directory/${businessId}`)')
    expect(read('components/BoardHub.tsx')).toContain("'/login?return=/board/new'")
  })

  it('a guest liking an article is sent back to it', () => {
    const like = read('components/ArticleLike.tsx')
    expect(like).toContain('router.push(`/login?next=${encodeURIComponent(pathname + window.location.search)}`)')
    expect(like).not.toContain("router.push('/login')")
  })
})
