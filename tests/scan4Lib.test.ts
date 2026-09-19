import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { SignJWT } from 'jose'
import { NextRequest } from 'next/server'

// Fourth scan, library + route fixes:
//   1. no-show dates on the member's city clock
//   2. settlement in end-time order, so an earlier card exists before a later event is judged
//   3. check-in closed on cancelled and settled events
//   4. host emoji escaped in the weekly digest
//   5. initials are letters, never half a surrogate pair
//   6. a "TBA – 02:00" event ends the next morning
//   7. /api/invite honours the referred member's privacy
//   8. every jwtVerify pinned to HS256

const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() }
const session = { current: { id: 'me', role: 'member', name: 'Me', email: 'me@x', color: '#fff' } as any }

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',  () => ({
  sendYellowCardEmail:        vi.fn().mockResolvedValue(undefined),
  sendRedCardEmail:           vi.fn().mockResolvedValue(undefined),
  sendHostNoShowCardsEmail:   vi.fn().mockResolvedValue(undefined),
  sendAdminNoShowAppealEmail: vi.fn().mockResolvedValue(undefined),
  recordEmailFailure:         vi.fn(),
}))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => false) }))
vi.mock('@/lib/access', () => ({
  isAdmin:            vi.fn(() => false),
  isAdminOrModerator: vi.fn(() => false),
  isClubHost:         vi.fn(async () => false),
  canManageEventOps:  vi.fn(async () => true),
}))
vi.mock('@/lib/city', () => ({
  VIEW_CITY_COOKIE: 'smileys_view_city',
  getDefaultCityId: vi.fn(async () => 'c-ist'),
  todayInCity:      vi.fn(async (_c: string, off = 0) => (off === 7 ? '2026-09-21' : off === -7 ? '2026-09-07' : '2026-09-14')),
  getCityConfig:    vi.fn(async () => ({ country: 'TR' })),
  // The check-in route reads the event's city clock on every toggle (standing's resolution line).
  getCityTz:        vi.fn(async () => 'Europe/Istanbul'),
}))
vi.mock('@/lib/content', () => ({ loadContent: () => ({}) }))
// Routes get a stubbed session; the JWT pin below imports the real module.
vi.mock('@/lib/session', async (orig) => ({ ...(await orig<any>()), getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:     vi.fn(),
  city:             { findMany: vi.fn(), findUnique: vi.fn() },
  club:             { findMany: vi.fn() },
  event:            { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  eventAttendee:    { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  eventCoHost:      { findMany: vi.fn() },
  eventPhoto:       { findMany: vi.fn() },
  listing:          { findMany: vi.fn() },
  memberApplication:{ count: vi.fn(), findMany: vi.fn() },
  memberConnection: { findMany: vi.fn(), count: vi.fn() },
  noShowCard:       { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  post:             { findMany: vi.fn() },
  session:          { findUnique: vi.fn(), update: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 1 })) },
  user:             { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  waitlistEntry:    { findMany: vi.fn(), deleteMany: vi.fn() },
} }))

import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { PATCH as checkinPatch } from '@/app/api/events/[id]/checkin/route'
import { buildWeeklyDigest } from '@/lib/newsletterDigest'
import { getInitials } from '@/lib/data'
import { eventEndsAt } from '@/lib/eventTime'
import { GET as inviteGet } from '@/app/api/invite/route'

const p = prisma as any
const H = 60 * 60 * 1000
const TBILISI = { city: { timezone: 'Asia/Tbilisi' } }
// 00:30 on 15 Oct in Tbilisi (UTC+4) — still 23:30 on the 14th in Istanbul (UTC+3).
const ENDS = new Date('2026-10-14T20:30:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  ;(createNotification as any).mockResolvedValue(undefined)
  p.$transaction.mockImplementation(async (fn: any) => fn(p))
  p.eventCoHost.findMany.mockResolvedValue([])
  p.user.findMany.mockResolvedValue([])
  p.noShowCard.update.mockResolvedValue({})
  p.noShowCard.updateMany.mockResolvedValue({ count: 0 })
  session.current = { id: 'me', role: 'member', name: 'Me', email: 'me@x', color: '#fff' }
})

// ── 1 ────────────────────────────────────────────────────────────────────────

// 1 and 2 went with v1. The first covered gateErrorBody's block date, and v2
// has no dated block — a red card says what clears it, not when it lifts. The
// second covered sweepNoShows processing events in end-time order so the
// SECOND absence got the red; decideIssuance sorts offences by occurredAt, so
// the order they are processed in cannot decide a card's colour any more.
describe('3. check-in is closed on cancelled and settled events', () => {
  const patch = (body: unknown) => checkinPatch(
    new NextRequest('http://localhost/api/events/e1/checkin', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'e1' }) },
  )
  const live = { status: 'published', cancelledAt: null, noShowProcessedAt: null, date: '2099-01-01', time: '19:00' }

  it('a cancelled event refuses both directions with 400 and writes nothing', async () => {
    p.event.findUnique.mockResolvedValue({ ...live, cancelledAt: new Date() })
    expect((await patch({ userId: 'u1', checkedIn: true })).status).toBe(400)
    p.event.findUnique.mockResolvedValue({ ...live, status: 'cancelled' })
    expect((await patch({ userId: 'u1', checkedIn: false })).status).toBe(400)
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })

  it('a settled event refuses un-checking — the no_show mark under a standing card is not erased', async () => {
    p.event.findUnique.mockResolvedValue({ ...live, noShowProcessedAt: new Date() })
    const res = await patch({ userId: 'u1', checkedIn: false })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('attendance_settled')
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })

  it('a settled event refuses a late check-in too — the correction is a waiver, not a rewrite', async () => {
    p.event.findUnique.mockResolvedValue({ ...live, noShowProcessedAt: new Date() })
    expect((await patch({ userId: 'u1', checkedIn: true })).status).toBe(409)
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })

  it('a live event still toggles, and the write itself re-checks the event is unsettled', async () => {
    p.event.findUnique.mockResolvedValue(live)
    p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
    p.eventAttendee.findUnique.mockResolvedValue({ id: 'a1', checkedIn: false })
    const res = await patch({ userId: 'u1', checkedIn: false })
    expect(res.status).toBe(200)
    expect(p.eventAttendee.updateMany.mock.calls[0][0]).toEqual({
      where: { userId: 'u1', eventId: 'e1', status: 'approved', event: { noShowProcessedAt: null, cancelledAt: null } },
      data:  { checkedIn: false, attendance: 'unknown' },
    })
  })

  it('an unknown event is a 404, not a write', async () => {
    p.event.findUnique.mockResolvedValue(null)
    expect((await patch({ userId: 'u1', checkedIn: true })).status).toBe(404)
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })
})

// ── 4 ────────────────────────────────────────────────────────────────────────

describe('4. the weekly digest escapes host-supplied emoji', () => {
  it('neither the event card nor the photo caption carries raw markup', async () => {
    const evil = '"><img src=x onerror=alert(1)>'
    p.event.findMany.mockResolvedValue([{ id: 'e1', title: 'Picnic', date: '2026-09-15', time: '18:00', neighborhood: null, emoji: evil, spotsLeft: 10, totalSpots: 10 }])
    p.club.findMany.mockResolvedValue([])
    p.user.findMany.mockResolvedValue([])
    p.eventPhoto.findMany.mockResolvedValue([{ url: 'https://img.example/p.jpg', event: { id: 'e0', title: 'Last week', emoji: '<script>x</script>', _count: { attendees: 5 } } }])
    p.event.count.mockResolvedValue(0)
    p.eventAttendee.count.mockResolvedValue(0)
    p.memberConnection.count.mockResolvedValue(0)
    p.listing.findMany.mockResolvedValue([])
    p.post.findMany.mockResolvedValue([])
    p.city.findUnique.mockResolvedValue({ name: 'Istanbul' })

    const digest = await buildWeeklyDigest()
    expect(digest).not.toBeNull()
    const html = digest!.bodyHtml
    expect(html).not.toContain('onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt; Picnic')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; Last week')
  })
})

// ── 5 ────────────────────────────────────────────────────────────────────────

describe('5. getInitials is code-point aware and only returns letters', () => {
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

  it('skips a leading emoji token', () => {
    expect(getInitials('🙂 Nate')).toBe('N')
    expect(getInitials('🙂 Nate Yaman')).toBe('NY')
    expect(getInitials('🧘‍♀️ Ayşe Kaya')).toBe('AK')
  })

  it('skips symbols glued to the front of a word', () => {
    expect(getInitials('🙂Nate Yaman')).toBe('NY')
    expect(getInitials('"nate" (yaman)')).toBe('NY')
  })

  it('never yields half a surrogate pair', () => {
    for (const n of ['🙂 Nate', '🙂', '𝒩ate 🙂', '🙂 🙂']) expect(getInitials(n)).not.toMatch(loneSurrogate)
    expect(getInitials('🙂 🙂')).toBe('')
  })

  it('keeps accents, Turkish letters and combining marks with their letter', () => {
    expect(getInitials('Émile Zola')).toBe('ÉZ')
    expect(getInitials('Şule Öztürk')).toBe('ŞÖ')
    expect(getInitials('Émile Zola')).toBe('ÉZ')
  })

  it('is unchanged for ordinary names', () => {
    expect(getInitials('Hilmi Songur')).toBe('HS')
    expect(getInitials('Dr. Hilmi Songur')).toBe('HS')
    expect(getInitials('aisha k.')).toBe('AK')
    expect(getInitials('Cher')).toBe('C')
    expect(getInitials('')).toBe('')
  })
})

// ── 6 ────────────────────────────────────────────────────────────────────────

describe('6. eventEndsAt with an unknown start', () => {
  const IST = 'Europe/Istanbul'
  it('an early-morning end (before 06:00) rolls past midnight', () => {
    expect(eventEndsAt({ date: '2026-09-12', time: 'TBA', endTime: '02:00' }, IST).toISOString()).toBe('2026-09-12T23:00:00.000Z')
    expect(eventEndsAt({ date: '2026-09-12', time: null, endTime: '05:59' }, IST).toISOString()).toBe('2026-09-13T02:59:00.000Z')
  })
  it('from 06:00 on, the end stays on the event’s date', () => {
    expect(eventEndsAt({ date: '2026-09-12', time: 'TBA', endTime: '06:00' }, IST).toISOString()).toBe('2026-09-12T03:00:00.000Z')
    expect(eventEndsAt({ date: '2026-09-12', time: '', endTime: '23:00' }, IST).toISOString()).toBe('2026-09-12T20:00:00.000Z')
  })
  it('a known start still decides by comparison, as before', () => {
    expect(eventEndsAt({ date: '2026-09-12', time: '00:30', endTime: '02:00' }, IST).toISOString()).toBe('2026-09-11T23:00:00.000Z')
    expect(eventEndsAt({ date: '2026-09-12', time: '22:00', endTime: '02:00' }, IST).toISOString()).toBe('2026-09-12T23:00:00.000Z')
  })
})

// ── 7 ────────────────────────────────────────────────────────────────────────

describe('7. /api/invite respects the referred members’ privacy', () => {
  it('drops neighbourhood, and blanks the photo for connections-only strangers and hidden members', async () => {
    p.user.findUnique.mockResolvedValue({ referralCode: 'CODE', referralCount: 4, name: 'Me' })
    p.memberApplication.count.mockResolvedValue(0)
    p.memberApplication.findMany.mockResolvedValue([{ email: 'a' }, { email: 'b' }, { email: 'c' }, { email: 'd' }])
    const u = (id: string, o: any = {}) => ({ id, name: id.toUpperCase(), color: '#000', profilePhoto: `/p/${id}.jpg`, neighborhood: 'Moda',
      joinedAt: new Date('2026-09-01T00:00:00Z'), profileVisibility: 'everyone', hiddenFromMembers: false, ...o })
    p.user.findMany.mockResolvedValue([
      u('open'),
      u('private', { profileVisibility: 'connections' }),
      u('friend',  { profileVisibility: 'connections' }),
      u('hidden',  { hiddenFromMembers: true }),
    ])
    p.memberConnection.findMany.mockResolvedValue([{ requesterId: 'me', receiverId: 'friend' }])

    const body = await (await inviteGet()).json()
    const byId = Object.fromEntries(body.joined.map((j: any) => [j.id, j]))
    expect(byId.open.profilePhoto).toBe('/p/open.jpg')
    expect(byId.friend.profilePhoto).toBe('/p/friend.jpg')
    expect(byId.private.profilePhoto).toBeNull()
    expect(byId.hidden.profilePhoto).toBeNull()
    for (const j of body.joined) {
      expect(Object.keys(j).sort()).toEqual(['color', 'id', 'joinedAt', 'name', 'profilePhoto'])
    }
    expect(p.user.findMany.mock.calls[0][0].select.neighborhood).toBeUndefined()
  })
})

// ── 8 ────────────────────────────────────────────────────────────────────────

describe('8. every jwtVerify is pinned to HS256', () => {
  const SECRET = new TextEncoder().encode(process.env.JWT_SECRET)
  const claims = { user: { id: 'u1', name: 'Jane', email: 'j@x', role: 'member', color: '#fff', tokenVersion: 0 } }

  it('getSession rejects a token signed with another HMAC algorithm under the same secret', async () => {
    const { getSession } = await vi.importActual<typeof import('@/lib/session')>('@/lib/session')
    p.user.findUnique.mockResolvedValue({ status: 'approved', suspendedUntil: null, tokenVersion: 0, cityId: 'c', email: 'j@x', totpEnabled: false, neighborhood: null })
    p.session.findUnique.mockResolvedValue(null)

    const hs256 = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(SECRET)
    cookieStore.get.mockImplementation((n: string) => (n === 'smileys_session' ? { value: hs256 } : undefined))
    expect((await getSession())?.id).toBe('u1')

    const hs512 = await new SignJWT(claims).setProtectedHeader({ alg: 'HS512' }).setExpirationTime('1h').sign(SECRET)
    cookieStore.get.mockImplementation((n: string) => (n === 'smileys_session' ? { value: hs512 } : undefined))
    expect(await getSession()).toBeNull()
  })

  it('source: no unpinned jwtVerify anywhere in lib/ or app/', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : [])
    const files = [...walk('lib'), ...walk('app')].filter(f => /jwtVerify\(/.test(readFileSync(f, 'utf8')))
    expect(files.sort()).toEqual(['app/api/auth/2fa/verify/route.ts', 'lib/session.ts'])
    for (const f of files) {
      const src = readFileSync(path.join(process.cwd(), f), 'utf8')
      const calls = src.match(/jwtVerify\([^)]*\)/g) ?? []
      expect(calls.length, f).toBeGreaterThan(0)
      for (const c of calls) expect(c, f).toContain("algorithms: ['HS256']")
    }
  })
})
