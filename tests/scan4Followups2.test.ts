import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Follow-ups 1–8 after scan 4 (2026-09-13).
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => ({
  event:            { findUnique: vi.fn() },
  club:             { findUnique: vi.fn(), update: vi.fn() },
  clubMembership:   { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn(async () => []) },
  user:             { findUnique: vi.fn() },
  cityRelationship: { findFirst: vi.fn() },
  $transaction:     vi.fn(async (ops: unknown[]) => ops),
  $queryRaw:        vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => true) }))

import { autoJoinClub } from '@/lib/autoJoinClub'
import { getIp } from '@/lib/rateLimit'

describe('1. red-card email dates follow the member city', () => {
  it('the email formats in the zone it is given, and the sweep passes the member zone', () => {
    const email = read('lib/email.ts')
    expect(email).toMatch(/function fmtDate\(d: Date, tz: string = DEFAULT_TZ\)/)
    expect(email).toContain('${fmtDate(dates.restrictionEndsAt, tz)}')
    expect(email).toContain('${fmtDate(dates.appealDeadlineAt, tz)}')
    expect(read('lib/noShow.ts')).toContain('restrictionEndsAt: c.restrictionEndsAt }, tz)')
  })
})

describe('2. RSVP auto-join follows the join-the-city-first rule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    p.event.findUnique.mockResolvedValue({ clubId: 'club1' })
    p.clubMembership.findUnique.mockResolvedValue(null)
    p.user.findUnique.mockResolvedValue({ cityId: 'istanbul' })
    p.cityRelationship.findFirst.mockResolvedValue(null)
  })
  const club = (over: Record<string, unknown>) => ({ isPrivate: false, name: 'Hikers', slug: 'hikers', isActive: true, cityId: 'istanbul', ...over })

  it('joins a club in the member home city', async () => {
    p.club.findUnique.mockResolvedValue(club({}))
    await autoJoinClub('u1', 'e1')
    expect(p.clubMembership.create).toHaveBeenCalled()
  })
  it('does not join another city club the member has not joined', async () => {
    p.club.findUnique.mockResolvedValue(club({ cityId: 'tbilisi' }))
    await autoJoinClub('u1', 'e1')
    expect(p.clubMembership.create).not.toHaveBeenCalled()
  })
  it('joins another city club when the member joined that city', async () => {
    p.club.findUnique.mockResolvedValue(club({ cityId: 'tbilisi' }))
    p.cityRelationship.findFirst.mockResolvedValue({ id: 'rel' })
    await autoJoinClub('u1', 'e1')
    expect(p.clubMembership.create).toHaveBeenCalled()
    expect(p.cityRelationship.findFirst.mock.calls[0][0].where).toEqual({ userId: 'u1', cityId: 'tbilisi', type: 'member' })
  })
  it('joins a global club from anywhere, and never an inactive one', async () => {
    p.club.findUnique.mockResolvedValue(club({ cityId: null }))
    await autoJoinClub('u1', 'e1')
    expect(p.clubMembership.create).toHaveBeenCalledTimes(1)
    p.club.findUnique.mockResolvedValue(club({ isActive: false }))
    await autoJoinClub('u1', 'e1')
    expect(p.clubMembership.create).toHaveBeenCalledTimes(1)
  })
})

describe('3. a claimed scheduled newsletter is aged from its claim', () => {
  it('the scheduled → sending claim stamps sentAt', () => {
    expect(read('app/api/cron/sweep-newsletters/route.ts')).toContain("data:  { status: 'sending', sentAt: new Date() },")
  })
})

describe('4. a late-settling event sees cards on both sides of it', () => {
  it('the prior-card window extends a full window past this event', () => {
    expect(read('lib/noShow.ts')).toContain('lte: new Date(endsAt.getTime() + NO_SHOW_ROLLING_WINDOW_DAYS * DAY)')
  })
})

describe('5. editing a scheduled newsletter retires the original in one request', () => {
  const api  = read('app/api/admin/newsletter/route.ts')
  const page = read('app/admin/newsletter/page.tsx')
  it('the API deletes the still-scheduled original inside the transaction that writes the copy', () => {
    expect(api).toMatch(/prisma\.\$transaction\(async tx => \{\s*if \(replacesId\) \{\s*const gone = await tx\.newsletter\.deleteMany\(\{ where: \{ id: replacesId, status: 'scheduled' \} \}\)\s*if \(gone\.count === 0\) return null/)
    expect(api).toContain('if (!newsletter) return NextResponse.json(REPLACED_GONE, { status: 409 })')
  })
  it('a send-now copy checks recipients, then retires the original, then fans out', () => {
    // Updated 2026-09-13 (scan 5 #1): retiring before the recipient check
    // stranded the edit on an empty segment.
    const recipients = api.indexOf('const recipients = await prisma.user.findMany(')
    const retire     = api.indexOf("const gone = await prisma.newsletter.deleteMany({ where: { id: replacesId, status: 'scheduled' } })")
    const fanout     = api.indexOf('batch = await sendNewsletterBatch(')
    expect(recipients).toBeGreaterThan(-1)
    expect(recipients).toBeLessThan(retire)
    expect(retire).toBeLessThan(fanout)
  })
  it('the page sends replacesId and no longer deletes in a second call', () => {
    expect(page).toContain('replacesId:   editingId ?? undefined,')
    expect(page).not.toContain('retireEditedOriginal')
  })
})

describe('6. payments totals are per currency', () => {
  it('the API groups paid sums by currency and tags each event with its currency', () => {
    const api = read('app/api/admin/payments/route.ts')
    expect(api).toMatch(/prisma\.payment\.groupBy\(\{\s*by:\s*\['currency'\],\s*where: \{ status: 'paid' \}/)
    expect(api).not.toContain('paidSum')
    expect(api).toContain('currency: meta.currency ?? DEFAULT_CURRENCY')
  })
  it('the page formats each total and event row in its own currency', () => {
    const page = read('app/admin/payments/page.tsx')
    expect(page).toContain('stats.paidByCurrency.map(g => formatMoney(g.amount, g.currency))')
    expect(page).toContain('formatMoney(e.paidTotal, e.currency)')
    expect(page).not.toMatch(/formatMoney\(e\.(paid|pending)Total, cur\)/)
  })
})

describe('7. the directory says when a city neighborhood list failed', () => {
  it('a failed or non-ok fetch marks the city, and its rows show a note', () => {
    const page = read('app/admin/directory/page.tsx')
    expect(page).toContain("r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))")
    expect(page).toContain('setHoodsFailed(prev => ({ ...prev, [slug]: true }))')
    expect(page).toContain('neighborhoodsFailed={!!(b.city?.slug && hoodsFailed[b.city.slug])}')
    expect(page).toContain("Couldn&apos;t load this city&apos;s neighborhoods")
  })
})

describe('8. getIp only accepts real addresses', () => {
  const reqWith = (h: Record<string, string>) => ({ headers: { get: (k: string) => h[k.toLowerCase()] ?? null } }) as unknown as Request
  it('rejects hostnames and word tokens', () => {
    expect(getIp(reqWith({ 'x-real-ip': 'localhost' }))).toBe('unknown')
    expect(getIp(reqWith({ 'x-real-ip': 'abc_def' }))).toBe('unknown')
    expect(getIp(reqWith({ 'x-forwarded-for': 'unknown' }))).toBe('unknown')
    expect(getIp(reqWith({ 'x-real-ip': '999.1.1.1' }))).toBe('unknown')
  })
  it('keeps IPv4, IPv6 and bracketed IPv6', () => {
    expect(getIp(reqWith({ 'x-real-ip': '10.0.0.1' }))).toBe('10.0.0.1')
    expect(getIp(reqWith({ 'x-real-ip': '[2001:db8::1]' }))).toBe('2001:db8::1')
    expect(getIp(reqWith({ 'x-forwarded-for': '1.1.1.1, ::ffff:10.0.0.2' }))).toBe('::ffff:10.0.0.2')
  })
})
