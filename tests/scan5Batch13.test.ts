import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Scan 5, batch 13 — host event status (51), the AI helpers (52) and the
// co-host route (53).

const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create } } } }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access', () => ({
  isAdmin:            (s: any) => s?.role === 'admin',
  isModerator:        (s: any) => s?.role === 'moderator',
  isAdminOrModerator: (s: any) => s?.role === 'admin' || s?.role === 'moderator',
  isClubHost:         vi.fn(),
  isClubHostFor:      vi.fn(),
  hostCityIds:        vi.fn(),
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn() }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(), notifyNewEvent: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), getDiff: vi.fn(() => null) }))
vi.mock('@/lib/email', () => ({ sendEventCancelledEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/spotsLeft', () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/noShow', () => ({ waiveCard: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction:  vi.fn(async (ops: any) => Promise.all(ops)),
    event:         { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    eventAttendee: { findMany: vi.fn(), updateMany: vi.fn() },
    waitlistEntry: { deleteMany: vi.fn() },
    auditLog:      { findMany: vi.fn() },
    user:          { findUnique: vi.fn() },
    eventCoHost:   { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    tagGroup:      { findMany: vi.fn() },
  },
}))

import { PUT } from '@/app/api/admin/events/[id]/route'
import { POST as DESCRIBE } from '@/app/api/host/events/describe/route'
import { POST as SUGGEST } from '@/app/api/host/events/suggest-tags/route'
import { POST as ADD_COHOST, DELETE as REMOVE_COHOST } from '@/app/api/admin/events/[id]/cohosts/route'
import { getSession } from '@/lib/session'
import { isClubHost, isClubHostFor, hostCityIds } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification, notifyNewEvent } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const flush = () => new Promise(r => setTimeout(r, 0))

const host   = { id: 'h1', name: 'Host', role: 'member', cityId: 'c1' }
const member = { id: 'u9', name: 'Member', role: 'member', cityId: 'c1' }
const admin  = { id: 'a1', name: 'Admin', role: 'admin', cityId: 'c1' }
const params = { params: Promise.resolve({ id: 'e1' }) } as never

// The routes only read req.json(); `bad` makes it reject like malformed JSON.
function req(body: unknown, bad = false) {
  return { json: async () => { if (bad) throw new SyntaxError('Unexpected token'); return body } } as never
}

function existing(status: string) {
  return {
    hostId: 'h1', clubId: 'club1', cityId: 'c1', date: '2026-10-01', time: '19:00',
    location: 'x', title: 'Picnic', neighborhood: 'x', price: 0, memberPrice: null,
    totalSpots: 10, emoji: '🎉', isPremium: false, membersOnly: false,
    limitedSpots: false, isFirstTimerFriendly: false, status, seriesId: null,
    cancelledAt: null, approvalRequired: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m(getSession).mockResolvedValue(host)
  m(isClubHost).mockResolvedValue(true)
  m(isClubHostFor).mockResolvedValue(true)
  m(hostCityIds).mockResolvedValue([])
  m(rateLimit).mockResolvedValue(true)
  m(createNotification).mockResolvedValue(true)
  m(notifyNewEvent).mockResolvedValue(undefined)
  create.mockResolvedValue({ choices: [{ message: { content: '{"tagIds":[]}' } }] })
  m(prisma.event.update).mockImplementation(async ({ data }: any) => ({ id: 'e1', totalSpots: 10, ...data }))
  m(prisma.eventAttendee.findMany).mockResolvedValue([])
  m(prisma.eventAttendee.updateMany).mockResolvedValue({ count: 0 })
  m(prisma.waitlistEntry.deleteMany).mockResolvedValue({ count: 0 })
  m(prisma.auditLog.findMany).mockResolvedValue([])
  m(prisma.user.findUnique).mockResolvedValue({ name: 'Ayla', status: 'approved', city: { name: 'Bursa' } })
  m(prisma.tagGroup.findMany).mockResolvedValue([])
  m(prisma.eventCoHost.upsert).mockResolvedValue({ id: 'ch1', userId: 'u2' })
  m(prisma.eventCoHost.deleteMany).mockResolvedValue({ count: 1 })
})

describe('51a. a host can bring back an event staff already published', () => {
  it('draft → published is allowed when the audit trail has a staff publish', async () => {
    m(prisma.event.findUnique).mockResolvedValue(existing('draft'))
    m(prisma.auditLog.findMany).mockResolvedValue([{ action: 'event.published', meta: { status: 'published' } }])
    const res = await PUT(req({ status: 'published' }), params)
    expect(res.status).toBe(200)
    expect(m(prisma.event.update).mock.calls[0][0].data.status).toBe('published')
    expect(m(prisma.auditLog.findMany).mock.calls[0][0].where).toMatchObject({ targetType: 'event', targetId: 'e1' })
  })
  it('postponed → published is allowed on a staff edit that set published', async () => {
    m(prisma.event.findUnique).mockResolvedValue(existing('postponed'))
    m(prisma.auditLog.findMany).mockResolvedValue([{ action: 'event.update', meta: { diff: { status: { from: 'pending', to: 'published' } } } }])
    expect((await PUT(req({ status: 'published' }), params)).status).toBe(200)
  })
  it('still refused with no staff publish on record', async () => {
    m(prisma.event.findUnique).mockResolvedValue(existing('draft'))
    m(prisma.auditLog.findMany).mockResolvedValue([{ action: 'event.update', meta: { diff: { title: { from: 'a', to: 'b' } } } }])
    expect((await PUT(req({ status: 'published' }), params)).status).toBe(403)
    expect(prisma.event.update).not.toHaveBeenCalled()
  })
  it('pending is never reopened by a host, whatever the history', async () => {
    m(prisma.event.findUnique).mockResolvedValue(existing('pending'))
    m(prisma.auditLog.findMany).mockResolvedValue([{ action: 'event.published', meta: {} }])
    expect((await PUT(req({ status: 'published' }), params)).status).toBe(403)
    expect(prisma.event.update).not.toHaveBeenCalled()
  })
  it('a failed audit lookup fails closed', async () => {
    m(prisma.event.findUnique).mockResolvedValue(existing('draft'))
    m(prisma.auditLog.findMany).mockRejectedValue(new Error('db down'))
    expect((await PUT(req({ status: 'published' }), params)).status).toBe(403)
    expect(prisma.event.update).not.toHaveBeenCalled()
  })
})

describe('51b. parking a live event asks first', () => {
  it('host events list confirms before the PUT', () => {
    const src = read('app/host/events/page.tsx')
    const fn = src.slice(src.indexOf('async function handleStatusChange'))
    const gate = fn.indexOf("if (current?.status === 'published' && (status === 'draft' || status === 'postponed') &&")
    expect(gate).toBeGreaterThan(-1)
    expect(fn.slice(gate, gate + 200)).toMatch(/!\(await confirmToast\(parkLiveEventMessage\(status\)/)
    expect(gate).toBeLessThan(fn.indexOf('fetch('))
    expect(src).toMatch(/It leaves the public feed/)
    expect(src).toMatch(/otherwise a moderator has to/)
  })
  it('host edit form confirms before the PUT', () => {
    const src = read('app/host/events/[id]/edit/page.tsx')
    const save = src.slice(src.indexOf('async function handleSave()'))
    const gate = save.indexOf("if (loadedStatus === 'published' && (form.status === 'draft' || form.status === 'postponed') &&")
    expect(gate).toBeGreaterThan(-1)
    expect(save.slice(gate, gate + 400)).toMatch(/!\(await confirmToast\(/)
    expect(gate).toBeLessThan(save.indexOf('fetch('))
    // …and the parked event can be put back from the same select.
    expect(src).toContain(`{!isStaff && (loadedStatus === 'draft' || loadedStatus === 'postponed') && <option value="published">`)
  })
})

describe('51c. postponing a live event tells the people going', () => {
  it('host: one event_updated notification per approved attendee', async () => {
    m(prisma.event.findUnique).mockResolvedValue(existing('published'))
    m(prisma.eventAttendee.findMany).mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])
    const res = await PUT(req({ status: 'postponed' }), params)
    expect(res.status).toBe(200)
    await flush()
    expect(m(prisma.eventAttendee.findMany).mock.calls[0][0].where).toEqual({ eventId: 'e1', status: 'approved' })
    const calls = m(createNotification).mock.calls
    expect(calls.map(c => c[0]).sort()).toEqual(['u1', 'u2'])
    for (const c of calls) {
      expect(c[1]).toBe('event_updated')
      expect(c[4]).toBe('/events/e1')
    }
  })
  it('staff postponing notifies too', async () => {
    m(getSession).mockResolvedValue(admin)
    m(prisma.event.findUnique).mockResolvedValue(existing('published'))
    m(prisma.eventAttendee.findMany).mockResolvedValue([{ userId: 'u1' }])
    await PUT(req({ status: 'postponed' }), params)
    await flush()
    expect(createNotification).toHaveBeenCalledTimes(1)
  })
  it('draft, or an event that was not live, sends nothing', async () => {
    m(prisma.eventAttendee.findMany).mockResolvedValue([{ userId: 'u1' }])
    m(prisma.event.findUnique).mockResolvedValue(existing('published'))
    await PUT(req({ status: 'draft' }), params)
    m(prisma.event.findUnique).mockResolvedValue(existing('draft'))
    await PUT(req({ status: 'postponed' }), params)
    await flush()
    expect(createNotification).not.toHaveBeenCalled()
  })
})

describe('52. AI describe / suggest-tags are host tools with bounded input', () => {
  const good = { title: 'Picnic', location: 'Park', vibes: ['chill'], notes: 'bring food' }

  it('a plain member gets 403 and spends nothing', async () => {
    m(getSession).mockResolvedValue(member)
    m(isClubHost).mockResolvedValue(false)
    for (const handler of [DESCRIBE, SUGGEST]) {
      const res = await handler(req(good))
      expect(res.status).toBe(403)
    }
    expect(create).not.toHaveBeenCalled()
    expect(rateLimit).not.toHaveBeenCalled()
  })
  it('club hosts, city hosts and moderators are let through', async () => {
    expect((await DESCRIBE(req(good))).status).toBe(200)
    m(isClubHost).mockResolvedValue(false)
    m(hostCityIds).mockResolvedValue(['c1'])
    expect((await SUGGEST(req({ title: 'Picnic' }))).status).toBe(200)
    m(hostCityIds).mockResolvedValue([])
    m(getSession).mockResolvedValue({ ...member, role: 'moderator' })
    expect((await DESCRIBE(req(good))).status).toBe(200)
  })
  it('malformed JSON is a 400', async () => {
    expect((await DESCRIBE(req(null, true))).status).toBe(400)
    expect((await SUGGEST(req(null, true))).status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })
  it('describe: oversize or wrongly-typed fields are a 400', async () => {
    const bad = [
      { ...good, title: 'x'.repeat(201) },
      { ...good, title: 42 },
      { ...good, location: 'x'.repeat(201) },
      { ...good, notes: 'x'.repeat(2001) },
      { ...good, notes: { a: 1 } },
      { ...good, vibes: 'chill' },
      { ...good, vibes: Array.from({ length: 21 }, () => 'a') },
      { ...good, vibes: ['x'.repeat(41)] },
      { ...good, vibes: [1] },
    ]
    for (const body of bad) {
      const res = await DESCRIBE(req(body))
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400)
    }
    expect(create).not.toHaveBeenCalled()
  })
  it('describe: vibes may be absent; the edit forms send [] and empty strings', async () => {
    expect((await DESCRIBE(req({ title: 'Picnic' }))).status).toBe(200)
    expect((await DESCRIBE(req({ title: 'Picnic', location: '', vibes: [], notes: '' }))).status).toBe(200)
  })
  it('suggest-tags: oversize or wrongly-typed fields are a 400', async () => {
    for (const body of [
      { title: 'x'.repeat(201) },
      { title: 7 },
      { description: ['x'] },
      { description: `<p>${'x'.repeat(2001)}</p>` },
    ]) {
      expect((await SUGGEST(req(body))).status).toBe(400)
    }
    expect(create).not.toHaveBeenCalled()
  })
  it('suggest-tags: the cap is on text, not rich-text markup', async () => {
    const html = Array.from({ length: 300 }, () => '<p><strong>fun</strong></p>').join('')
    expect((await SUGGEST(req({ title: 'Picnic', description: html }))).status).toBe(200)
  })
})

describe('53. co-host route validates, throttles and audits', () => {
  beforeEach(() => {
    m(prisma.event.findUnique).mockResolvedValue({ hostId: 'h1', title: 'Picnic' })
  })

  it('a non-string or empty userId is a 400 with nothing written', async () => {
    for (const body of [{ userId: 123 }, { userId: '' }, { userId: { id: 'x' } }, {}]) {
      expect((await ADD_COHOST(req(body), params)).status).toBe(400)
    }
    expect((await ADD_COHOST(req(null, true), params)).status).toBe(400)
    expect(prisma.eventCoHost.upsert).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })
  it('an unknown member is a 404, an unapproved one a 400 — no create', async () => {
    m(prisma.user.findUnique).mockResolvedValueOnce(null)
    expect((await ADD_COHOST(req({ userId: 'ghost' }), params)).status).toBe(404)
    m(prisma.user.findUnique).mockResolvedValueOnce({ name: 'P', status: 'pending' })
    expect((await ADD_COHOST(req({ userId: 'u3' }), params)).status).toBe(400)
    expect(prisma.eventCoHost.upsert).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })
  it("the event's own host can't be added", async () => {
    expect((await ADD_COHOST(req({ userId: 'h1' }), params)).status).toBe(400)
    expect(prisma.eventCoHost.upsert).not.toHaveBeenCalled()
  })
  it('rate limited per session across add and remove → 429', async () => {
    m(rateLimit).mockResolvedValue(false)
    expect((await ADD_COHOST(req({ userId: 'u2' }), params)).status).toBe(429)
    expect((await REMOVE_COHOST(req({ userId: 'u2' }), params)).status).toBe(429)
    expect(m(rateLimit).mock.calls.map(c => c[0])).toEqual(['cohosts:h1', 'cohosts:h1'])
    expect(prisma.eventCoHost.upsert).not.toHaveBeenCalled()
    expect(prisma.eventCoHost.deleteMany).not.toHaveBeenCalled()
  })
  it('an add writes an audit row', async () => {
    const res = await ADD_COHOST(req({ userId: 'u2' }), params)
    expect(res.status).toBe(200)
    expect(writeAudit).toHaveBeenCalledWith('h1', 'Host', 'event.cohost_add', 'u2', 'user',
      expect.objectContaining({ eventId: 'e1', eventTitle: 'Picnic', userName: 'Ayla' }), expect.any(String))
  })
  it('authorization is unchanged: someone else\'s event is still a 403', async () => {
    m(getSession).mockResolvedValue(member)
    expect((await ADD_COHOST(req({ userId: 'u2' }), params)).status).toBe(403)
    expect(rateLimit).not.toHaveBeenCalled()
  })
  it('a database failure is a JSON 500, not an unhandled throw', async () => {
    m(prisma.eventCoHost.upsert).mockRejectedValue(new Error('P2003'))
    const res = await ADD_COHOST(req({ userId: 'u2' }), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Server error' })
  })
  it('remove validates userId too', async () => {
    expect((await REMOVE_COHOST(req({ userId: 5 }), params)).status).toBe(400)
    expect(prisma.eventCoHost.deleteMany).not.toHaveBeenCalled()
  })
})
