import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import * as fs from 'fs'

// Scan 5, items 42–46: global clubs and global quotes that moderators could
// reach through canActInCity's "no city" parity, network-wide content writes
// open to moderators, a broadcast that hid its failures and could be sent
// twice, and a banners editor that could post a stale or empty list.
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => {
  const m: Record<string, any> = {
    broadcast:      { findMany: vi.fn(async () => []), create: vi.fn(async () => ({ id: 'b1' })), update: vi.fn(async () => ({})) },
    notificationPreference: { findMany: vi.fn(async () => []) },
    club:           { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    event:          { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    city:           { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id })) },
    user:           { findMany: vi.fn(async () => []), findUnique: vi.fn() },
    clubMembership: { findMany: vi.fn(async () => []) },
    eventAttendee:  { findMany: vi.fn(async () => []) },
    testimonial:    {
      findUnique: vi.fn(), findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 't-new' })), update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})), aggregate: vi.fn(async () => ({ _max: { order: 0 } })),
    },
    communityPoll:  {
      updateMany: vi.fn(async () => ({})),
      create: vi.fn(async () => ({ id: 'p1', question: 'Q' })),
      update: vi.fn(async () => ({ id: 'p1', question: 'Q' })),
    },
  }
  m.$transaction = vi.fn(async (fn: any) => fn(m))
  return m
})
const h = vi.hoisted(() => ({
  session: { current: null as Record<string, unknown> | null },
  files:   {} as Record<string, string>,
}))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => h.session.current) }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => true), recipientSkipReason: vi.fn(() => null) }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendBroadcastEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn(async () => {}) }))
vi.mock('@/lib/rateLimit', () => ({ claimOnce: vi.fn(async () => true), releaseClaim: vi.fn(async () => {}), rateLimitRemaining: vi.fn(async () => 5), rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/stepUp', () => ({ requireStepUp: vi.fn(() => null) }))
vi.mock('@/lib/communityStats', () => ({ getCommunityStats: vi.fn(async () => ({ members: 0, events: 0, clubs: 0 })) }))
// data/*.json is served from h.files; every other path (the source pins
// below) reads the real disk. Writes are recorded, never performed.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  const isData = (f: unknown) => /[\\/]data[\\/][\w.-]+\.json$/.test(String(f))
  const readFileSync = vi.fn((f: any, ...rest: any[]) => {
    if (!isData(f)) return (actual.readFileSync as any)(f, ...rest)
    const name = String(f).split(/[\\/]/).pop()!
    if (name in h.files) return h.files[name]
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  const mod = { ...actual, readFileSync, writeFileSync: vi.fn(), renameSync: vi.fn(), mkdirSync: vi.fn() }
  return { ...mod, default: mod }
})

import { GET as broadcastGET, POST as broadcastPOST } from '@/app/api/admin/notifications/broadcast/route'
import { POST as quotePOST, PATCH as quoteReorder } from '@/app/api/admin/testimonials/route'
import { PATCH as quotePATCH, DELETE as quoteDELETE } from '@/app/api/admin/testimonials/[id]/route'
import { GET as announcementGET, POST as announcementPOST } from '@/app/api/admin/announcement/route'
import { POST as pollPOST, PATCH as pollPATCH } from '@/app/api/admin/community-poll/route'
import { POST as bannersPOST } from '@/app/api/admin/banners/route'
import { POST as contentPOST } from '@/app/api/admin/content/route'
import { POST as spotlightPOST, DELETE as spotlightDELETE } from '@/app/api/admin/spotlight/route'
import { sendBroadcastEmail, recordEmailFailure } from '@/lib/email'
import { createNotification } from '@/lib/notify'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'

const admin = { id: 'a1', name: 'Admin', role: 'admin',     cityId: 'c-ist', totpVerified: true }
const mod   = { id: 'm1', name: 'Mod',   role: 'moderator', cityId: 'c-ist' }

const req = (body?: unknown) =>
  new Request('https://x/app/api', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }) as never
const params = (id: string) => ({ params: Promise.resolve({ id }) })

let seq = 0
const rid = () => `req-${String(++seq).padStart(8, '0')}`
const send = (body: Record<string, unknown>) =>
  broadcastPOST(req({ title: 'T', message: 'M', channel: 'in-app', requestId: rid(), ...body }))

beforeEach(() => {
  vi.clearAllMocks()
  h.session.current = admin
  for (const k of Object.keys(h.files)) delete h.files[k]
})

describe('42a — broadcasts to a global club', () => {
  it('a moderator cannot broadcast to a club with no city', async () => {
    h.session.current = mod
    p.club.findUnique.mockResolvedValueOnce({ cityId: null })
    const res = await send({ audience: 'club', clubId: 'k-global' })
    expect(res.status).toBe(403)
    expect(p.clubMembership.findMany).not.toHaveBeenCalled()
    expect(claimOnce).not.toHaveBeenCalled()
  })

  it('a moderator still reaches a club in their own city', async () => {
    h.session.current = mod
    p.club.findUnique.mockResolvedValueOnce({ cityId: 'c-ist' })
    p.clubMembership.findMany.mockResolvedValueOnce([{ user: { id: 'u1', name: 'U', email: 'u@x', emailMarketing: true, emailVerified: true, status: 'approved', suspendedUntil: null } }])
    expect((await send({ audience: 'club', clubId: 'k-ist' })).status).toBe(202)
    expect(p.clubMembership.findMany).toHaveBeenCalledTimes(1)
  })

  it('an admin can broadcast to a global club', async () => {
    p.clubMembership.findMany.mockResolvedValueOnce([{ user: { id: 'u1', name: 'U', email: 'u@x', emailMarketing: true, emailVerified: true, status: 'approved', suspendedUntil: null } }])
    expect((await send({ audience: 'club', clubId: 'k-global' })).status).toBe(202)
    expect(p.clubMembership.findMany).toHaveBeenCalledTimes(1)
  })
})

describe('42a — broadcast history for moderators', () => {
  it('keeps own-city sends and club/event sends in their city; drops global, foreign and orphaned', async () => {
    h.session.current = mod
    p.broadcast.findMany.mockResolvedValueOnce([
      { id: 'b-city',     cityId: 'c-ist', audience: 'city',  clubId: null,     eventId: null },
      { id: 'b-club-ist', cityId: null,    audience: 'club',  clubId: 'k-ist',  eventId: null },
      { id: 'b-club-bod', cityId: null,    audience: 'club',  clubId: 'k-bod',  eventId: null },
      { id: 'b-club-glo', cityId: null,    audience: 'club',  clubId: 'k-glo',  eventId: null },
      { id: 'b-club-del', cityId: null,    audience: 'club',  clubId: 'k-gone', eventId: null },
      { id: 'b-ev-ist',   cityId: null,    audience: 'event', clubId: null,     eventId: 'e-ist' },
      { id: 'b-ev-bod',   cityId: null,    audience: 'event', clubId: null,     eventId: 'e-bod' },
      { id: 'b-all',      cityId: null,    audience: 'all',   clubId: null,     eventId: null },
    ])
    p.club.findMany.mockResolvedValueOnce([{ id: 'k-ist', cityId: 'c-ist' }, { id: 'k-bod', cityId: 'c-bod' }, { id: 'k-glo', cityId: null }])
    p.event.findMany.mockResolvedValueOnce([{ id: 'e-ist', cityId: 'c-ist' }, { id: 'e-bod', cityId: 'c-bod' }])
    // GET answers { history, sendsLeftToday } since the 2026-09-22 review.
    const { history: rows } = await (await broadcastGET()).json()
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['b-city', 'b-club-ist', 'b-ev-ist'])
    // The query itself no longer asks for every cityId-null row.
    expect(p.broadcast.findMany.mock.calls[0][0].where.OR).not.toContainEqual({ cityId: null })
  })

  it('admins still get the unfiltered history', async () => {
    await broadcastGET()
    expect(p.broadcast.findMany.mock.calls[0][0].where).toBeUndefined()
    expect(p.club.findMany).not.toHaveBeenCalled()
  })
})

describe('42b — testimonials: moderators never touch across-Smileys quotes', () => {
  const quote = (cityId: unknown) => ({ memberName: 'Ayşe', quote: 'Lovely people', cityId })

  it('POST: a moderator cannot create a global quote, but can create one for their city', async () => {
    h.session.current = mod
    const res = await quotePOST(req(quote('')))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/admin-only/)
    expect(p.testimonial.create).not.toHaveBeenCalled()
    expect((await quotePOST(req(quote('c-ist')))).status).toBe(200)
    expect(p.testimonial.create.mock.calls[0][0].data.cityId).toBe('c-ist')
  })

  it('POST: an admin can still create a global quote', async () => {
    expect((await quotePOST(req(quote(null)))).status).toBe(200)
    expect(p.testimonial.create.mock.calls[0][0].data.cityId).toBeNull()
  })

  it('PATCH: a moderator can neither edit a global quote nor move their own to global', async () => {
    h.session.current = mod
    p.testimonial.findUnique.mockResolvedValueOnce({ cityId: null })
    expect((await quotePATCH(req({ active: false }), params('t-glo'))).status).toBe(403)
    p.testimonial.findUnique.mockResolvedValueOnce({ cityId: 'c-ist' })
    expect((await quotePATCH(req({ cityId: '' }), params('t-ist'))).status).toBe(403)
    expect(p.testimonial.update).not.toHaveBeenCalled()
    p.testimonial.findUnique.mockResolvedValueOnce({ cityId: 'c-ist' })
    expect((await quotePATCH(req({ quote: 'Edited' }), params('t-ist'))).status).toBe(200)
  })

  it('DELETE: global quotes are admin-only', async () => {
    const snap = { memberName: 'x', role: null, quote: 'q', category: 'general', active: true, cityId: null }
    h.session.current = mod
    p.testimonial.findUnique.mockResolvedValueOnce(snap)
    expect((await quoteDELETE(req(), params('t-glo'))).status).toBe(403)
    expect(p.testimonial.delete).not.toHaveBeenCalled()
    h.session.current = admin
    p.testimonial.findUnique.mockResolvedValueOnce(snap)
    expect((await quoteDELETE(req(), params('t-glo'))).status).toBe(200)
    expect(p.testimonial.delete).toHaveBeenCalledTimes(1)
  })

  it('reorder: a list containing a global quote is refused for a moderator', async () => {
    h.session.current = mod
    p.testimonial.findMany.mockResolvedValueOnce([{ cityId: 'c-ist' }, { cityId: null }])
    expect((await quoteReorder(req({ ids: ['t-ist', 't-glo'] }))).status).toBe(403)
    expect(p.testimonial.update).not.toHaveBeenCalled()
  })
})

describe('43 — network-wide content writes are admin-only', () => {
  it('announcement: moderator 403 with nothing written, admin 200; moderators still read', async () => {
    h.session.current = mod
    expect((await announcementPOST(req({ text: 'Hi', link: '', active: true }))).status).toBe(403)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
    expect((await announcementGET()).status).toBe(200)
    h.session.current = admin
    expect((await announcementPOST(req({ text: 'Hi', link: '', active: true }))).status).toBe(200)
    expect(fs.renameSync).toHaveBeenCalledTimes(1)
  })

  it('community poll: POST and PATCH refuse a moderator; admin PATCH passes', async () => {
    h.session.current = mod
    expect((await pollPOST(req({ question: 'Q?', options: ['A', 'B'] }))).status).toBe(403)
    expect((await pollPATCH(req({ pollId: 'p1', active: false }))).status).toBe(403)
    expect(p.$transaction).not.toHaveBeenCalled()
    h.session.current = admin
    expect((await pollPATCH(req({ pollId: 'p1', active: false }))).status).toBe(200)
  })

  it('banners and content: moderator 403', async () => {
    h.session.current = mod
    expect((await bannersPOST(req({ page: 'dashboard', banners: [], baseVersion: '' }))).status).toBe(403)
    expect((await contentPOST(req({ home: { headline: 'H', subtitle: 'S' } }))).status).toBe(403)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('spotlight: POST and DELETE refuse a moderator even for their own member', async () => {
    h.session.current = mod
    p.user.findUnique.mockResolvedValue({ cityId: 'c-ist', status: 'approved' })
    expect((await spotlightPOST(req({ userId: 'u-ist' }))).status).toBe(403)
    expect((await spotlightDELETE()).status).toBe(403)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('spotlight DELETE writes atomically, like POST', async () => {
    expect((await spotlightDELETE()).status).toBe(200)
    const [tmpPath] = (fs.writeFileSync as any).mock.calls[0]
    expect(String(tmpPath)).toMatch(/member-spotlight\.json\.tmp$/)
    expect(fs.renameSync).toHaveBeenCalledWith(tmpPath, String(tmpPath).replace(/\.tmp$/, ''))
  })
})

describe('44 — broadcast sends in chunks and reports what really happened', () => {
  it('never more than 50 emails in flight, failures recorded, counts honest', async () => {
    const users = Array.from({ length: 120 }, (_, i) => ({ id: `u${i}`, name: `U ${i}`, email: `u${i}@x.test`, emailMarketing: true, emailVerified: true, status: 'approved', suspendedUntil: null }))
    p.user.findMany.mockResolvedValueOnce(users)
    let inFlight = 0, maxInFlight = 0
    ;(sendBroadcastEmail as any).mockImplementation(async (_id: string, email: string) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(r => setTimeout(r, 0))
      inFlight--
      if (email === 'u7@x.test') throw new Error('Resend 429')
    })
    ;(createNotification as any).mockImplementation(async (id: string) => id !== 'u3')

    const res = await send({ audience: 'city', cityId: 'c-ist', channel: 'email' })
    // 202: the row is written and the answer given BEFORE the fan-out — a
    // whole-membership email is ~16 minutes of paced sends and nginx closes
    // the connection at 60s, so the history has to answer "did it go" while
    // it is still going. The response carries the list size; the counts of
    // what actually went out land on the row when the fan-out finishes.
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ queued: 120, emailEligible: 120 })
    expect(p.broadcast.create.mock.calls[0][0].data).toMatchObject({ sentCount: 0, finishedAt: null })
    await vi.waitFor(() => expect(p.broadcast.update).toHaveBeenCalled())
    expect(sendBroadcastEmail).toHaveBeenCalledTimes(120)
    expect(maxInFlight).toBe(50)
    expect(recordEmailFailure).toHaveBeenCalledTimes(1)
    expect(recordEmailFailure).toHaveBeenCalledWith(expect.objectContaining({ helper: 'sendBroadcastEmail', recipient: 'u7@x.test' }))
    // The history row records what went out, not the list size — per channel.
    expect(p.broadcast.update.mock.calls[0][0].data).toMatchObject({ emailedCount: 119, notifiedCount: 119, sentCount: 119 })
    expect(p.broadcast.update.mock.calls[0][0].data.finishedAt).toBeInstanceOf(Date)
    ;(sendBroadcastEmail as any).mockImplementation(async () => {})
    ;(createNotification as any).mockImplementation(async () => true)
  })
})

describe('45 — one send per composed broadcast', () => {
  it('a missing or malformed requestId is a 400 before anything is claimed or fetched', async () => {
    const noId = await broadcastPOST(req({ title: 'T', message: 'M', audience: 'city', cityId: 'c-ist' }))
    expect(noId.status).toBe(400)
    expect((await send({ audience: 'city', cityId: 'c-ist', requestId: 'no spaces!' })).status).toBe(400)
    expect(claimOnce).not.toHaveBeenCalled()
    expect(p.user.findMany).not.toHaveBeenCalled()
  })

  it('a duplicate id answers 409 and sends nothing', async () => {
    ;(claimOnce as any).mockResolvedValueOnce(false)
    const res = await send({ audience: 'city', cityId: 'c-ist', requestId: 'req-abcdef12' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('This broadcast was already sent')
    // A day since 2026-09-22: a whole-membership email runs ~16 minutes and
    // the same id pressed again after the old hour sent it all twice.
    expect(claimOnce).toHaveBeenCalledWith('broadcast:a1:req-abcdef12', 24 * 60 * 60_000)
    expect(p.user.findMany).not.toHaveBeenCalled()
    expect(p.broadcast.create).not.toHaveBeenCalled()
  })

  it('a refused attempt never burns the id', async () => {
    h.session.current = mod
    expect((await send({ audience: 'city', cityId: 'c-bod' })).status).toBe(403)
    expect(claimOnce).not.toHaveBeenCalled()
  })

  it('a failure before anything went out hands the claim back', async () => {
    p.user.findMany.mockRejectedValueOnce(new Error('db down'))
    await expect(send({ audience: 'city', cityId: 'c-ist', requestId: 'req-release1' })).rejects.toThrow('db down')
    expect(releaseClaim).toHaveBeenCalledWith('broadcast:a1:req-release1')
  })
})

describe('46 — banners writes are built on the stored list', () => {
  const stored = { id: 's1', page: 'dashboard', type: 'sponsored', active: true, headline: 'Sponsor', subtitle: '', emoji: '🏷️', link: '', cta: '', bg: '', updatedAt: 't1' }

  it('refuses a write without a baseVersion', async () => {
    expect((await bannersPOST(req({ page: 'dashboard', banners: [] }))).status).toBe(400)
  })

  it('a stale list (e.g. the empty state after a failed load) is a 409 that returns the stored list', async () => {
    h.files['banners.json'] = JSON.stringify({ dashboard: [stored] })
    const res = await bannersPOST(req({ page: 'dashboard', banners: [], baseVersion: '' }))
    expect(res.status).toBe(409)
    expect((await res.json()).banners).toHaveLength(1)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('a write built on the current list goes through', async () => {
    h.files['banners.json'] = JSON.stringify({ dashboard: [stored] })
    const res = await bannersPOST(req({ page: 'dashboard', banners: [{ ...stored, active: false }], baseVersion: 's1@t1' }))
    expect(res.status).toBe(200)
    expect(fs.renameSync).toHaveBeenCalledTimes(1)
  })

  it('the page gates writes on a successful load and serialises them', () => {
    const src = read('app/admin/banners/page.tsx')
    expect(src).not.toMatch(/return EMPTY_BANNERS/)
    expect(src).toMatch(/<LoadErrorBanner message=\{loadError\} onRetry=\{load\}/)
    expect(src).toMatch(/if \(!isAdmin \|\| !loaded \|\| writing\.current\) return false/)
    // Built from the latest confirmed list, versioned, and replaced from the response.
    expect(src).toMatch(/const current = bannersRef\.current\[page\]/)
    expect(src).toMatch(/baseVersion: versionOf\(current\)/)
    expect(src).toMatch(/applyPage\(page, data\.banners\)/)
    expect(src.match(/disabled=\{!canWrite/g)?.length ?? 0).toBeGreaterThanOrEqual(6)
    // No write path posts the render-time array any more.
    expect(src).not.toMatch(/\(banners\[page\] \|\| \[\]\)/)
  })
})

describe('pages — honest broadcast result and moderator-read-only network content', () => {
  it('the notifications page sends a request id, checks res.ok before parsing, and keeps the id on an unclear answer', () => {
    const src = read('app/admin/notifications/page.tsx')
    // Anchored on the end of the file, not on runCron: that function moved to
    // /admin/jobs with the Scheduled Jobs block (2026-09-22), and indexOf
    // returning -1 quietly sliced to the second-to-last character instead.
    expect(src).toContain('async function handleSend')
    const send = src.slice(src.indexOf('async function handleSend'), src.indexOf('return ('))
    // …and the payload now carries the optional broadcast image.
    expect(send).toMatch(/eventId: eventId \|\| null, imageUrl, requestId \}/)
    expect(send).not.toMatch(/await res\.json\(\)/)
    expect(send.indexOf('if (!res.ok)')).toBeLessThan(send.indexOf('readJsonBody(res)'))
    expect(send).toMatch(/toast\.warning\(MAYBE_SENT/)
    // Only a confirmed send (200 or 409) rotates the id.
    expect(send.match(/setRequestId\(newRequestId\(\)\)/g)).toHaveLength(2)
    // The 202 carries the list size; the per-channel counts land on the
    // history row when the fan-out finishes (2026-09-22).
    expect(send).toMatch(/data\.queued/)
    expect(src).toMatch(/crypto\.randomUUID\(\)/)
  })

  it.each([
    'app/admin/announcements/page.tsx',
    'app/admin/polls/page.tsx',
    'app/admin/banners/page.tsx',
    'app/admin/content/page.tsx',
    'app/admin/spotlight/page.tsx',
  ])('%s tells moderators network-wide content is admin-only', file => {
    const src = read(file)
    expect(src).toMatch(/const isAdmin = user\.role === 'admin'/)
    expect(src).toMatch(/Network-wide content is admin-only/)
  })
})
