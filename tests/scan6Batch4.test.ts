import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 6, batch 4: de45dcd made isClubHost ignore inactive clubs, but every
// other derivation of club-host authority still counted them. The host of a
// deactivated club (whose events deactivation does not cancel) could open the
// roster with contact details, broadcast, run the door and waive cards, and a
// host of one active + one inactive club got both clubs' attendees from the
// participants inbox. Principle: hosting an inactive club grants nothing that
// exposes members' data or acts on members. Staff, event hosts and co-hosts
// are unchanged.
//
// lib/access is REAL here; prisma is a tiny in-memory store whose membership
// queries honour `club: { isActive }`, so each test proves the filter.

const h = vi.hoisted(() => {
  const clubs: Record<string, { id: string; slug: string; name: string; emoji: string; memberCount: number; isActive: boolean; cityId: string; isPrivate: boolean }> = {
    'k-on':  { id: 'k-on',  slug: 'on',  name: 'Hikers', emoji: '🥾', memberCount: 4, isActive: true,  cityId: 'c1', isPrivate: false },
    'k-off': { id: 'k-off', slug: 'off', name: 'Gone',   emoji: '💤', memberCount: 3, isActive: false, cityId: 'c1', isPrivate: false },
  }
  const memberships = [
    { userId: 'hActive', clubId: 'k-on',  role: 'host', status: 'approved' },
    { userId: 'hDead',   clubId: 'k-off', role: 'host', status: 'approved' },
    { userId: 'hMixed',  clubId: 'k-on',  role: 'host', status: 'approved' },
    { userId: 'hMixed',  clubId: 'k-off', role: 'host', status: 'approved' },
  ]
  const events: Record<string, { id: string; clubId: string | null; hostId: string; title: string; date: string }> = {
    'e-on':  { id: 'e-on',  clubId: 'k-on',  hostId: 'owner', title: 'Hike',  date: '2099-01-01' },
    'e-off': { id: 'e-off', clubId: 'k-off', hostId: 'owner', title: 'Ghost', date: '2099-01-01' },
  }
  const attendees = [
    { id: 'a1', eventId: 'e-on',  userId: 'm1', status: 'approved', user: { id: 'm1', name: 'On',  email: 'on@x.test',  phone: '+901' } },
    { id: 'a2', eventId: 'e-off', userId: 'm2', status: 'approved', user: { id: 'm2', name: 'Off', email: 'off@x.test', phone: '+902' } },
  ]
  const matches = (m: Record<string, unknown>, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => k === 'club'
      ? Object.entries(v).every(([ck, cv]) => (clubs[m.clubId as string] as any)?.[ck] === cv)
      : m[k] === v)
  const clubSelect = (clubId: string, select: any) =>
    Object.fromEntries(Object.keys(select).map(k => [k, (clubs[clubId] as any)[k]]))
  const byEvent = (eventId: any) => (a: { eventId: string }) =>
    typeof eventId === 'string' ? a.eventId === eventId : eventId?.in ? eventId.in.includes(a.eventId) : true

  const prisma = {
    clubMembership: {
      count:     vi.fn(async ({ where }: any) => memberships.filter(m => matches(m, where)).length),
      findFirst: vi.fn(async ({ where }: any) => memberships.find(m => matches(m, where)) ? { id: 'cm' } : null),
      findMany:  vi.fn(async ({ where, select }: any) => memberships.filter(m => matches(m, where)).map(m => ({
        clubId: m.clubId, ...(select?.club ? { club: clubSelect(m.clubId, select.club.select) } : {}),
      }))),
      findUnique: vi.fn(async ({ where, select }: any) => {
        const m = memberships.find(x => x.userId === where.userId_clubId.userId && x.clubId === where.userId_clubId.clubId)
        if (!m) return null
        return { role: m.role, status: m.status, ...(select?.club ? { club: clubSelect(m.clubId, select.club.select) } : {}) }
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    club: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const c = Object.values(clubs).find(x => x.slug === where.slug || x.id === where.id)
        return c ? (select ? clubSelect(c.id, select) : { ...c }) : null
      }),
      findMany: vi.fn(async () => []),
      update:   vi.fn(async () => ({})),
    },
    city:        { findMany: vi.fn(async () => []) },
    cityHost:    { findMany: vi.fn(async () => []) },
    event: {
      findUnique: vi.fn(async ({ where }: any) => events[where.id] ?? null),
      findMany:   vi.fn(async ({ where }: any) => Object.values(events).filter(e => where?.clubId?.in ? where.clubId.in.includes(e.clubId) : true).map(e => ({ id: e.id }))),
    },
    eventCoHost:   { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    eventAttendee: {
      findMany: vi.fn(async ({ where }: any) => attendees.filter(byEvent(where?.eventId)).map(a => ({ ...a, user: { ...a.user }, event: { id: a.eventId, title: events[a.eventId].title } }))),
    },
    waitlistEntry: { findMany: vi.fn(async () => []) },
    payment:       { findMany: vi.fn(async () => []) },
    noShowCard:    { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => ({ eventId: 'e-on', userId: 'm1' })) },
    user: {
      findUnique: vi.fn(),
      findMany:   vi.fn(async () => []),
      update:     vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    totpBackupCode: { count: vi.fn(async () => 5) },
    clubPost: {
      findUnique: vi.fn(async () => ({ id: 'p1', clubId: 'k-on', userId: 'someone' })),
      update:     vi.fn(async () => ({ id: 'p1', isPinned: true })),
      delete:     vi.fn(async () => ({})),
    },
    clubPhoto: { findUnique: vi.fn(), delete: vi.fn(async () => ({})) },
    rateLimit: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(),
  }
  return { prisma, session: { current: null as any }, clubs }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/session', () => ({
  getSession:    vi.fn(async () => h.session.current),
  createSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => true), getIp: () => '1.2.3.4' }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/noShow', () => ({ waiveCard: vi.fn(async () => 'waived'), getRsvpGate: vi.fn(), gateErrorBody: vi.fn() }))
vi.mock('@/lib/email', () => ({
  sendEventApprovedEmail: vi.fn(), sendEventRejectedEmail: vi.fn(), recordEmailFailure: vi.fn(),
  sendNewDeviceLoginEmail: vi.fn(async () => {}), sendAccountLockedEmail: vi.fn(async () => {}),
}))
vi.mock('@/lib/autoJoinClub', () => ({ autoJoinClub: vi.fn() }))
vi.mock('@/lib/rsvpConfirmed', () => ({ createSeatPayment: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/city', () => ({
  todayInCity: vi.fn(async () => '2026-09-15'), resolveCityId: vi.fn(async () => 'c1'),
  citiesByToday: vi.fn(async () => [{ date: '2026-09-15', cityIds: ['c1'] }]),
  getCityTz: vi.fn(async () => 'Europe/Istanbul'), getDefaultCityId: vi.fn(async () => 'c1'),
  getCityConfig: vi.fn(async () => ({ name: 'Istanbul', timezone: 'Europe/Istanbul' })),
}))
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: vi.fn(async () => true) }))
vi.mock('@/lib/push', () => ({ sendPushToUser: vi.fn(async () => {}) }))
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(async () => true), hash: vi.fn() } }))
vi.mock('otplib/functional', () => ({ verifySync: vi.fn(() => ({ valid: true })) }))
vi.mock('@/lib/totpCrypto', () => ({ decryptTotpSecret: vi.fn(() => 'SECRET') }))

import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'
import { canManageEventOps, isClubHostFor, isClubHost } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { waiveCard } from '@/lib/noShow'
import { GET as eventParticipantsGET } from '@/app/api/admin/events/[id]/participants/route'
import { POST as broadcastPOST } from '@/app/api/host/events/[id]/broadcast/route'
import { GET as checkinGET, PATCH as checkinPATCH } from '@/app/api/events/[id]/checkin/route'
import { POST as waivePOST } from '@/app/api/events/[id]/no-shows/waive/route'
import { GET as inboxGET } from '@/app/api/admin/participants/route'
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { POST as verifyPOST } from '@/app/api/auth/2fa/verify/route'
import { GET as meGET } from '@/app/api/auth/me/route'
import { GET as hostClubsGET } from '@/app/api/host/clubs/route'
import { GET as clubMembersGET, PATCH as clubMembersPATCH } from '@/app/api/clubs/[slug]/members/route'
import { POST as clubPostPOST } from '@/app/api/clubs/[slug]/posts/route'
import { PATCH as clubPostPATCH, DELETE as clubPostDELETE } from '@/app/api/clubs/[slug]/posts/[postId]/route'
import { DELETE as clubPhotoDELETE } from '@/app/api/clubs/[slug]/photos/[id]/route'
import { PUT as spotlightPUT } from '@/app/api/clubs/[slug]/spotlight/route'

const p = h.prisma
const as = (id: string, role = 'member') => { h.session.current = { id, name: id, email: `${id}@x.test`, role, color: '#000', cityId: 'c1', sessionId: 's1', partnerId: null } }
const ev = (id: string) => ({ params: Promise.resolve({ id }) })
const club = (slug: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ slug, ...extra }) })
const jsonReq = (body: unknown, url = 'http://x.test/app/api/x', headers: Record<string, string> = {}) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })

beforeEach(() => {
  vi.clearAllMocks()
  h.session.current = null
})

describe('lib/access: club-host authority needs an active club', () => {
  it('canManageEventOps refuses the host of an inactive club, and says so in the query', async () => {
    await expect(canManageEventOps('hDead', 'member', 'e-off')).resolves.toBe(false)
    expect(p.clubMembership.findFirst.mock.calls[0][0].where).toMatchObject({ clubId: 'k-off', role: 'host', status: 'approved', club: { isActive: true } })
  })

  it('an active club\'s host, the event host, a co-host and admins are unchanged', async () => {
    await expect(canManageEventOps('hActive', 'member', 'e-on')).resolves.toBe(true)
    await expect(canManageEventOps('owner', 'member', 'e-off')).resolves.toBe(true)
    p.eventCoHost.findUnique.mockResolvedValueOnce({ userId: 'co' } as never)
    await expect(canManageEventOps('co', 'member', 'e-off')).resolves.toBe(true)
    await expect(canManageEventOps('anyone', 'admin', 'e-off')).resolves.toBe(true)
  })

  it('a mixed host runs only the active club\'s events', async () => {
    await expect(canManageEventOps('hMixed', 'member', 'e-on')).resolves.toBe(true)
    await expect(canManageEventOps('hMixed', 'member', 'e-off')).resolves.toBe(false)
  })

  it('isClubHostFor: no filing events under an inactive club', async () => {
    await expect(isClubHostFor('hDead', 'k-off')).resolves.toBe(false)
    await expect(isClubHostFor('hMixed', 'k-off')).resolves.toBe(false)
    await expect(isClubHostFor('hActive', 'k-on')).resolves.toBe(true)
    await expect(isClubHostFor('hActive', 'k-off')).resolves.toBe(false)
  })

  it('isClubHost (de45dcd) agrees with the store', async () => {
    await expect(isClubHost('hDead')).resolves.toBe(false)
    await expect(isClubHost('hMixed')).resolves.toBe(true)
  })
})

describe('event ops routes refuse an inactive club\'s host', () => {
  it('participants GET: 403, no roster read', async () => {
    as('hDead')
    const res = await eventParticipantsGET(new Request('http://x.test') as never, ev('e-off'))
    expect(res.status).toBe(403)
    expect(p.eventAttendee.findMany).not.toHaveBeenCalled()
  })

  it('participants GET: an active club\'s host still gets the roster (contact stripped, as before)', async () => {
    as('hActive')
    const res = await eventParticipantsGET(new Request('http://x.test') as never, ev('e-on'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.attendees.map((a: any) => a.userId)).toEqual(['m1'])
    expect(body.attendees[0].user).not.toHaveProperty('email')
  })

  it('broadcast: 403 and nobody notified; active host still reaches the room', async () => {
    as('hDead')
    expect((await broadcastPOST(jsonReq({ message: 'hello' }), ev('e-off'))).status).toBe(403)
    expect(createNotification).not.toHaveBeenCalled()

    as('hActive')
    const ok = await broadcastPOST(jsonReq({ message: 'hello' }), ev('e-on'))
    expect(ok.status).toBe(200)
    expect(createNotification).toHaveBeenCalledWith('m1', 'host_message', expect.any(String), 'hello', '/events/e-on')
  })

  it('check-in: GET and PATCH 403 for the inactive club\'s host; GET still opens for an active one', async () => {
    as('hDead')
    expect((await checkinGET(new NextRequest('http://x.test'), ev('e-off'))).status).toBe(403)
    const patch = new NextRequest('http://x.test', { method: 'PATCH', body: JSON.stringify({ userId: 'm2', checkedIn: true }) })
    expect((await checkinPATCH(patch, ev('e-off'))).status).toBe(403)

    as('hActive')
    const res = await checkinGET(new NextRequest('http://x.test'), ev('e-on'))
    expect(res.status).toBe(200)
    expect((await res.json()).map((a: any) => a.userId)).toEqual(['m1'])
  })

  it('waive: 403 and no card touched; active host still waives', async () => {
    as('hDead')
    expect((await waivePOST(jsonReq({ cardId: 'card1', reason: 'scanner broke' }), ev('e-off'))).status).toBe(403)
    expect(waiveCard).not.toHaveBeenCalled()

    as('hActive')
    await waivePOST(jsonReq({ cardId: 'card1', reason: 'scanner broke' }), ev('e-on'))
    expect(waiveCard).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'card1' }))
  })
})

describe('admin/participants inbox', () => {
  it('a host of one active and one inactive club sees only the active club\'s attendees', async () => {
    as('hMixed')
    const res = await inboxGET()
    expect(res.status).toBe(200)
    const { attendees } = await res.json()
    expect(attendees.map((a: any) => a.user.email)).toEqual(['on@x.test'])
    expect(p.clubMembership.findMany.mock.calls[0][0].where).toMatchObject({ club: { isActive: true } })
  })

  it('a host of only an inactive club is refused outright', async () => {
    as('hDead')
    expect((await inboxGET()).status).toBe(403)
    expect(p.eventAttendee.findMany).not.toHaveBeenCalled()
  })

  it('an active club\'s host is unchanged', async () => {
    as('hActive')
    const { attendees } = await (await inboxGET()).json()
    expect(attendees.map((a: any) => a.userId)).toEqual(['m1'])
  })
})

describe('session host flags ignore inactive clubs', () => {
  const userRow = (id: string) => ({
    id, name: 'Jane Doe', email: `${id}@x.test`, role: 'member', color: '#fff', bio: null, neighborhood: null,
    instagram: null, emailVerified: true, partnerId: null, password: '$2a$10$hash', status: 'approved',
    suspendedUntil: null, suspensionNote: null, totpEnabled: false, failedLoginCount: 0, loginLockedUntil: null,
    knownIps: ['1.2.3.4'], fingerprints: [], tokenVersion: 1, cityId: 'c1', lastActive: new Date(),
    totpSecret: 'enc', lastUsedTotpStep: null,
  })

  it.each([['hDead', false], ['hMixed', true], ['hActive', true]])('login: %s → isClubHost %s', async (id, flag) => {
    p.user.findUnique.mockResolvedValue(userRow(id))
    const res = await loginPOST(jsonReq({ email: `${id}@x.test`, password: 'pw', _cf: 'ok' }))
    expect(res.status).toBe(200)
    expect((await res.json()).isClubHost).toBe(flag)
  })

  it.each([['hDead', false], ['hActive', true]])('2fa verify: %s → isClubHost %s', async (id, flag) => {
    p.user.findUnique.mockResolvedValue({ ...userRow(id), totpEnabled: true })
    const pending = await new SignJWT({ userId: id, pending2fa: true })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET))
    const res = await verifyPOST(jsonReq({ code: '123456' }, 'http://x.test/app/api/auth/2fa/verify', { cookie: `smileys_2fa_pending=${pending}` }))
    expect(res.status).toBe(200)
    expect((await res.json()).isClubHost).toBe(flag)
  })

  it.each([['hDead', false], ['hActive', true]])('me: %s → isClubHost %s', async (id, flag) => {
    as(id)
    p.user.findUnique.mockResolvedValue(userRow(id))
    const body = await (await meGET()).json()
    expect(body.isClubHost).toBe(flag)
  })
})

describe('club host consoles and club routes', () => {
  it('host clubs list offers only active clubs to manage', async () => {
    as('hMixed')
    const rows = await (await hostClubsGET()).json()
    expect(rows.map((r: any) => [r.slug, r.canManage])).toEqual([['on', true]])
  })

  // The page is .tsx (jsx: preserve — vitest can't import it), so this one is
  // pinned on source like the other page checks.
  it('host club page 404s for a non-admin host of an inactive club', () => {
    const src = readFileSync('app/host/clubs/[slug]/page.tsx', 'utf-8')
    expect(src).toMatch(/isPrivate: true, isActive: true,/)
    expect(src).toMatch(/membership\?\.role !== 'host' \|\| membership\?\.status !== 'approved' \|\| !club\.isActive\) notFound\(\)/)
  })

  it('members: pending requests and approve/reject refused on an inactive club; active host unchanged', async () => {
    as('hDead')
    const pendingReq = new NextRequest('http://x.test/app/api/clubs/off/members?pending=1')
    expect((await clubMembersGET(pendingReq, club('off'))).status).toBe(403)
    const patch = (slug: string) => new NextRequest('http://x.test', { method: 'PATCH', body: JSON.stringify({ userId: 'm9', action: 'reject' }) })
    expect((await clubMembersPATCH(patch('off'), club('off'))).status).toBe(403)
    expect(p.clubMembership.deleteMany).not.toHaveBeenCalled()

    as('hActive')
    expect((await clubMembersPATCH(patch('on'), club('on'))).status).toBe(200)
    expect(p.clubMembership.deleteMany).toHaveBeenCalled()
  })

  it('posts: no announcement, pin or delete of others\' posts from an inactive club\'s host', async () => {
    as('hDead')
    expect((await clubPostPOST(jsonReq({ content: 'hi all', type: 'announcement' }), club('off'))).status).toBe(403)
    p.clubPost.findUnique.mockResolvedValue({ id: 'p1', clubId: 'k-off', userId: 'someone' } as never)
    const pin = () => new NextRequest('http://x.test', { method: 'PATCH', body: JSON.stringify({ isPinned: true }) })
    expect((await clubPostPATCH(pin(), club('off', { postId: 'p1' }) as never)).status).toBe(403)
    const edit = new NextRequest('http://x.test', { method: 'PATCH', body: JSON.stringify({ content: 'rewritten' }) })
    expect((await clubPostPATCH(edit, club('off', { postId: 'p1' }) as never)).status).toBe(403)
    expect((await clubPostDELETE(new NextRequest('http://x.test'), club('off', { postId: 'p1' }) as never)).status).toBe(403)
    expect(p.clubPost.update).not.toHaveBeenCalled()
    expect(p.clubPost.delete).not.toHaveBeenCalled()

    as('hActive')
    p.clubPost.findUnique.mockResolvedValue({ id: 'p1', clubId: 'k-on', userId: 'someone' } as never)
    expect((await clubPostPATCH(pin(), club('on', { postId: 'p1' }) as never)).status).toBe(200)
    expect((await clubPostDELETE(new NextRequest('http://x.test'), club('on', { postId: 'p1' }) as never)).status).toBe(200)
  })

  it('photos and spotlight: refused on an inactive club; active host unchanged', async () => {
    as('hDead')
    p.clubPhoto.findUnique.mockResolvedValue({ userId: 'someone', clubId: 'k-off' })
    expect((await clubPhotoDELETE(new NextRequest('http://x.test'), club('off', { id: 'ph1' }) as never)).status).toBe(403)
    expect(p.clubPhoto.delete).not.toHaveBeenCalled()
    const put = new NextRequest('http://x.test', { method: 'PUT', body: JSON.stringify({ userId: 'm1' }) })
    expect((await spotlightPUT(put, club('off'))).status).toBe(403)
    expect(p.club.update).not.toHaveBeenCalled()

    as('hActive')
    p.clubPhoto.findUnique.mockResolvedValue({ userId: 'someone', clubId: 'k-on' })
    expect((await clubPhotoDELETE(new NextRequest('http://x.test'), club('on', { id: 'ph1' }) as never)).status).toBe(200)
  })
})
