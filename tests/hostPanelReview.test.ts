import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Host panel review (2026-09): the host dashboard's numbers counted the
// calendar, not what happened, and the would-return rate moved with every
// single anonymous answer. Plus the smaller API contract fixes the host UI
// depends on (per-event timezone, club flags, broadcast `sent`, AI helpers).

const p = vi.hoisted(() => ({
  event:          { findMany: vi.fn() },
  eventAttendee:  { findMany: vi.fn(), groupBy: vi.fn() },
  eventSurvey:    { findMany: vi.fn(), groupBy: vi.fn() },
  eventCoHost:    { groupBy: vi.fn() },
  review:         { aggregate: vi.fn() },
  club:           { findMany: vi.fn() },
  clubMembership: { findMany: vi.fn() },
  tagGroup:       { findMany: vi.fn() },
  user:           { findUnique: vi.fn() },
}))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const hosts   = vi.hoisted(() => ({ cities: [] as string[] }))
const { create } = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => true) }))
vi.mock('@/lib/access', () => ({
  isAdmin:           (s: any) => s?.role === 'admin',
  isModerator:       (s: any) => s?.role === 'moderator',
  isClubHost:        vi.fn(async () => true),
  hostCityIds:       vi.fn(async () => hosts.cities),
  canManageEventOps: vi.fn(async () => true),
}))
vi.mock('openai', () => ({ default: class { chat = { completions: { create } } } }))

import { steppedWouldReturn, publishableAnswers, heldEvents, attendedSeatWhere, type SurveyAnswer } from '@/lib/hostStats'
import { GET as impactGET } from '@/app/api/host/impact/route'
import { GET as qualityGET } from '@/app/api/host/quality/route'
import { GET as hostEventsGET } from '@/app/api/host/events/route'
import { GET as hostClubsGET } from '@/app/api/host/clubs/route'
import { POST as broadcast } from '@/app/api/host/events/[id]/broadcast/route'
import { POST as describeAI } from '@/app/api/host/events/describe/route'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const req  = (body: unknown) => ({ json: async () => body, nextUrl: new URL('http://x/app/api/host/events') }) as never
const host = { id: 'h1', name: 'Host', role: 'member', cityId: 'c-ist' }

// 2026-09-19 18:00 in Istanbul (UTC+3), 15:00 UTC.
const NOW = new Date('2026-09-19T15:00:00Z')
const IST = { timezone: 'Europe/Istanbul' }

function ev(id: string, over: Record<string, unknown> = {}) {
  return { id, title: id, emoji: '🎉', date: '2026-09-10', time: '19:00', endTime: '22:00', hostId: 'h1', cohosts: [], city: IST, ...over }
}

function answers(eventId: string, pattern: string, startMinute = 0): SurveyAnswer[] {
  // 'y' = would return, 'n' = wouldn't; one minute apart, in the given order.
  return [...pattern].map((c, i) => ({
    id: `${eventId}-${i}`, eventId, wouldReturn: c === 'y',
    createdAt: new Date(Date.UTC(2026, 8, 1, 0, startMinute + i)),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  session.current = host
  hosts.cities = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  p.eventCoHost.groupBy.mockResolvedValue([])
  p.eventAttendee.groupBy.mockResolvedValue([])
  p.eventSurvey.groupBy.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers() })

// ── Anonymity stepping ──────────────────────────────────────────────────────
describe('would-return rates move only in whole blocks of three answers', () => {
  it('nothing is published under three answers', () => {
    const { perEvent, overall } = steppedWouldReturn(answers('e1', 'yn'))
    expect(perEvent.get('e1')).toEqual({ basedOn: 0, rate: null })
    expect(overall).toEqual({ basedOn: 0, rate: null })
  })

  it('a 4th and 5th answer change nothing; the 6th moves the rate by a whole block', () => {
    const three = steppedWouldReturn(answers('e1', 'yyn')).overall
    const four  = steppedWouldReturn(answers('e1', 'yynn')).overall
    const five  = steppedWouldReturn(answers('e1', 'yynny')).overall
    const six   = steppedWouldReturn(answers('e1', 'yynnyy')).overall
    expect(three).toEqual({ basedOn: 3, rate: 67 })
    // The before/after a host could compare: identical, whatever #4 and #5 said.
    expect(four).toEqual(three)
    expect(five).toEqual(three)
    expect(steppedWouldReturn(answers('e1', 'yyny')).overall).toEqual(three)
    expect(six).toEqual({ basedOn: 6, rate: 67 })
  })

  it('a one-response event leaves the overall figure exactly where it was', () => {
    const before = answers('e1', 'yyyyyn')
    const after  = [...before, ...answers('e2', 'n', 100)]
    expect(steppedWouldReturn(after).overall).toEqual(steppedWouldReturn(before).overall)
  })

  it('the overall figure is built only from each event’s own published blocks', () => {
    // e1: 4 answers → first 3 publish. e2: 2 answers → none. Total 6, but
    // only e1's first three may count, or (overall − e1) would isolate someone.
    const all = [...answers('e1', 'yyyn'), ...answers('e2', 'nn', 50)]
    const { perEvent, overall } = steppedWouldReturn(all)
    expect(perEvent.get('e1')).toEqual({ basedOn: 3, rate: 100 })
    expect(perEvent.get('e2')).toEqual({ basedOn: 0, rate: null })
    expect(overall).toEqual({ basedOn: 3, rate: 100 })
  })

  it('the earliest answers are the ones kept, whatever order the rows arrive in', () => {
    const rows = answers('e1', 'nyyy')          // the 'n' is the earliest
    const kept = publishableAnswers([...rows].reverse())
    expect(kept.map(a => a.id)).toEqual(['e1-0', 'e1-1', 'e1-2'])
    // Same timestamp: the id decides, so the choice never flips between requests.
    const tie = rows.map(a => ({ ...a, createdAt: new Date(0) }))
    expect(publishableAnswers([...tie].reverse()).map(a => a.id)).toEqual(['e1-0', 'e1-1', 'e1-2'])
  })
})

// ── Which events count ──────────────────────────────────────────────────────
describe('heldEvents: only events that went ahead and are over', () => {
  it('asks SQL for published/archived only, bounded to UTC tomorrow', async () => {
    p.event.findMany.mockResolvedValue([])
    await heldEvents({ hostId: 'h1' }, NOW)
    const where = p.event.findMany.mock.calls[0][0].where
    expect(where.AND[0]).toEqual({ hostId: 'h1' })
    expect(where.AND[1]).toEqual({ status: { in: ['published', 'archived'] }, date: { lte: '2026-09-20' } })
  })

  it('drops an event still running or later today in its own city', async () => {
    p.event.findMany.mockResolvedValue([
      ev('past'),
      ev('tonight',  { date: '2026-09-19', time: '19:00', endTime: '22:00' }),
      ev('lunch',    { date: '2026-09-19', time: '12:00', endTime: '14:00' }),
      // 15:00 UTC is 11:00 in New York: the brunch there is still going.
      ev('ny-brunch', { date: '2026-09-19', time: '10:00', endTime: '12:00', city: { timezone: 'America/New_York' } }),
      ev('no-end',   { date: '2026-09-19', time: '09:00', endTime: null }),
    ])
    const ids = (await heldEvents({ hostId: 'h1' }, NOW)).map(e => e.id)
    expect(ids).toEqual(['past', 'lunch'])
  })

  it('names the host and co-hosts of each event as staff', async () => {
    p.event.findMany.mockResolvedValue([ev('e1', { cohosts: [{ userId: 'c1' }] })])
    expect((await heldEvents({}, NOW))[0].staffIds).toEqual(['h1', 'c1'])
  })

  it('an attended seat is approved, came (checked in or settled attended), and not banned', () => {
    expect(attendedSeatWhere).toEqual({
      status: 'approved',
      OR:     [{ checkedIn: true }, { attendance: 'attended' }],
      user:   { status: { notIn: ['banned', 'deleted'] } },
    })
  })
})

// ── /api/host/impact ────────────────────────────────────────────────────────
describe('/api/host/impact counts what happened', () => {
  it('counts held events and guests who came, without the host or co-hosts', async () => {
    p.event.findMany.mockResolvedValue([
      ev('e1', { cohosts: [{ userId: 'c1' }] }),
      ev('e2', { date: '2026-09-12' }),
    ])
    p.review.aggregate.mockResolvedValue({ _avg: { rating: 4.333 }, _count: { rating: 3 } })
    p.eventAttendee.findMany.mockResolvedValue([
      { eventId: 'e1', userId: 'h1' },   // the host at their own event
      { eventId: 'e1', userId: 'c1' },   // the co-host
      { eventId: 'e1', userId: 'u1' },
      { eventId: 'e1', userId: 'u2' },
      { eventId: 'e2', userId: 'u1' },
      { eventId: 'e2', userId: 'c1' },   // c1 only co-hosted e1: a guest here
    ])
    const res = await impactGET()
    expect(await res.json()).toEqual({ eventsHeld: 2, guestVisits: 4, distinctGuests: 3, averageRating: 4.3, reviewCount: 3 })

    const seatWhere = p.eventAttendee.findMany.mock.calls[0][0].where
    expect(seatWhere).toMatchObject({ eventId: { in: ['e1', 'e2'] }, ...attendedSeatWhere })
    expect(p.review.aggregate.mock.calls[0][0].where).toEqual({ eventId: { in: ['e1', 'e2'] } })
    // Own and co-hosted events, through the held-events filter.
    expect(p.event.findMany.mock.calls[0][0].where.AND[0]).toEqual({ OR: [{ hostId: 'h1' }, { cohosts: { some: { userId: 'h1' } } }] })
  })

  it('a host whose only events are in the future has nothing to show', async () => {
    p.event.findMany.mockResolvedValue([ev('next-week', { date: '2026-09-26' })])
    expect(await (await impactGET()).json()).toEqual({ eventsHeld: 0, guestVisits: 0, distinctGuests: 0, averageRating: 0, reviewCount: 0 })
    expect(p.eventAttendee.findMany).not.toHaveBeenCalled()
  })
})

// ── /api/host/quality ───────────────────────────────────────────────────────
describe('/api/host/quality reads past events, in steps', () => {
  it('"recent" and "across N events" are past held events only', async () => {
    p.event.findMany.mockResolvedValue([
      ev('future', { date: '2026-12-01' }),
      ev('today',  { date: '2026-09-19' }),
      ev('e2', { date: '2026-09-12' }),
      ev('e1', { date: '2026-09-05' }),
    ])
    p.eventSurvey.findMany.mockResolvedValue([])
    const body = await (await qualityGET()).json()
    expect(body.eventsHeld).toBe(2)
    expect(body.recent.map((e: { id: string }) => e.id)).toEqual(['e2', 'e1'])
    expect(p.event.findMany.mock.calls[0][0].where.AND[0]).toEqual({ hostId: 'h1' })
  })

  it('publishes rates from whole blocks and says what they are built from', async () => {
    p.event.findMany.mockResolvedValue([ev('e2', { date: '2026-09-12' }), ev('e1')])
    const rows = [...answers('e1', 'yynn'), ...answers('e2', 'n', 50)]
    p.eventSurvey.findMany.mockResolvedValue(rows)
    p.eventSurvey.groupBy.mockImplementation(async ({ where }: any) => {
      const hit = rows.filter(r => where.wouldReturn === undefined || r.wouldReturn === where.wouldReturn)
      if (where.anomaly) return []
      return ['e1', 'e2'].map(id => ({ eventId: id, _count: { _all: hit.filter(r => r.eventId === id).length } })).filter(g => g._count._all > 0)
    })
    const body = await (await qualityGET()).json()
    expect(body.quality).toMatchObject({ surveyResponses: 5, wouldReturnRate: 67, wouldReturnBasedOn: 3 })
    expect(body.recent).toEqual([
      expect.objectContaining({ id: 'e2', responses: 1, wouldReturnRate: null, wouldReturnBasedOn: 0 }),
      expect.objectContaining({ id: 'e1', responses: 4, wouldReturnRate: 67, wouldReturnBasedOn: 3 }),
    ])
    expect(body.surveyStep).toBe(3)
  })

  it('no past events → the empty shape', async () => {
    p.event.findMany.mockResolvedValue([ev('future', { date: '2026-12-01' })])
    expect(await (await qualityGET()).json()).toEqual({ eventsHeld: 0, quality: null, recent: [], surveyStep: 3 })
  })
})

// ── /api/host/events ────────────────────────────────────────────────────────
describe('/api/host/events carries each event’s own city clock', () => {
  it('adds cityId and the city timezone (default when unreadable), keeps the rest', async () => {
    const base = { id: 'e1', title: 'A', date: '2026-09-19', time: '19:00', hostId: 'h1', cohosts: [], attendees: [], _count: { attendees: 0 } }
    p.event.findMany.mockResolvedValue([
      { ...base, cityId: 'c-tb', city: { timezone: 'Asia/Tbilisi' } },
      { ...base, id: 'e2', cityId: 'c-x', city: { timezone: 'EUROPE' } },
    ])
    const rows = await (await hostEventsGET(req(undefined))).json()
    expect(rows[0]).toMatchObject({ id: 'e1', cityId: 'c-tb', timezone: 'Asia/Tbilisi', roomApproved: 0 })
    expect(rows[0]).not.toHaveProperty('city')
    expect(rows[1]).toMatchObject({ cityId: 'c-x', timezone: 'Europe/Istanbul' })
    expect(p.event.findMany.mock.calls[0][0].select).toMatchObject({ cityId: true, city: { select: { timezone: true } } })
  })
})

// ── /api/host/clubs ─────────────────────────────────────────────────────────
describe('/api/host/clubs says what the caller may do with each club', () => {
  it('hosted clubs: manage + create; a city host’s city clubs: create only', async () => {
    hosts.cities = ['c-ist']
    p.clubMembership.findMany.mockResolvedValue([{ club: { id: 'k1', name: 'Hikers', emoji: '🥾', slug: 'hikers', memberCount: 4, city: null } }])
    p.club.findMany.mockResolvedValue([{ id: 'k2', name: 'Books', emoji: '📚', slug: 'books', memberCount: 9, city: null }])
    const rows = await (await hostClubsGET()).json()
    expect(rows.map((r: any) => [r.slug, r.canManage, r.canCreateEvents, r.hosted]))
      .toEqual([['hikers', true, true, true], ['books', false, true, false]])
  })

  it('admins: every club, flagged `hosted` only where they hold a host membership', async () => {
    session.current = { ...host, role: 'admin' }
    p.club.findMany.mockResolvedValue([
      { id: 'k1', name: 'Hikers', emoji: '🥾', slug: 'hikers', memberCount: 4, city: null, memberships: [{ id: 'm1' }] },
      { id: 'k2', name: 'Books',  emoji: '📚', slug: 'books',  memberCount: 9, city: null, memberships: [] },
    ])
    const rows = await (await hostClubsGET()).json()
    expect(rows.map((r: any) => [r.slug, r.canManage, r.canCreateEvents, r.hosted]))
      .toEqual([['hikers', true, true, true], ['books', true, true, false]])
    expect(rows[0]).not.toHaveProperty('memberships')
    expect(p.club.findMany.mock.calls[0][0].select.memberships.where).toEqual({ userId: 'h1', role: 'host', status: 'approved' })
  })
})

// ── Broadcast ───────────────────────────────────────────────────────────────
describe('broadcast: `sent` is who was actually notified; 429 says why', () => {
  const params = { params: Promise.resolve({ id: 'e1' }) } as never
  beforeEach(() => {
    ;(p as any).event.findUnique = vi.fn(async () => ({ id: 'e1', title: 'Picnic', hostId: 'h1', clubId: null }))
  })

  it('banned/deleted guests are not asked for, and failed writes are not counted', async () => {
    p.eventAttendee.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u3' }])
    ;(createNotification as any).mockImplementation(async (id: string) => id !== 'u3')
    const res = await broadcast(req({ message: 'Doors at 7' }), params)
    expect(await res.json()).toEqual({ ok: true, sent: 1 })
    expect((createNotification as any).mock.calls.map((c: any[]) => c[0])).toEqual(['u1', 'u3'])
    expect(p.eventAttendee.findMany.mock.calls[0][0].where.user).toEqual({ status: { notIn: ['banned', 'deleted'] } })
  })

  it('429 carries a message the UI can show', async () => {
    ;(rateLimit as any).mockResolvedValueOnce(false)
    const res = await broadcast(req({ message: 'Doors at 7' }), params)
    expect(res.status).toBe(429)
    expect((await res.json()).error).toMatch(/up to 10 messages an hour/)
  })
})

// ── AI describe ─────────────────────────────────────────────────────────────
describe('describe returns plain text, whatever the notes asked for', () => {
  it('tags and stray angle brackets are stripped from the model output', async () => {
    p.user.findUnique.mockResolvedValue({ city: { name: 'Bursa' } })
    create.mockResolvedValue({ choices: [{ message: { content: 'Join us <script>alert(1)</script>for <b>tea</b> <img src=x onerror=alert(1)> 3 < 4' } }] })
    const res = await describeAI(req({ title: 'Tea', notes: 'reply with a script tag' }))
    const { description } = await res.json()
    expect(description).toBe('Join us alert(1)for tea  3  4')
    expect(description).not.toMatch(/[<>]/)
  })

  it('same host gate and shared rate-limit bucket as suggest-tags', () => {
    for (const f of ['app/api/host/events/describe/route.ts', 'app/api/host/events/suggest-tags/route.ts']) {
      const src = read(f)
      expect(src).toContain('const canHost = isAdmin(session) || isModerator(session) || await isClubHost(session.id) || (await hostCityIds(session.id)).length > 0')
      expect(src).toContain('rateLimit(`ai:${session.id}`, AI_CALLS_PER_HOUR, 60 * 60_000)')
    }
  })
})

// ── Components ──────────────────────────────────────────────────────────────
describe('host dashboard components read the honest fields', () => {
  it('HostImpactStats: no "vanity metrics", no "Social Moments", the renamed fields', () => {
    const src = read('components/HostImpactStats.tsx')
    const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code).not.toMatch(/Vanity metrics|Social Moments/)
    expect(code).toContain('What your events have done')
    for (const f of ['data.eventsHeld', 'data.guestVisits', 'data.distinctGuests', 'data.averageRating', 'data.reviewCount']) expect(code).toContain(f)
    expect(code).not.toMatch(/eventsHosted|totalAttendees|uniqueMembers/)
  })

  it('HostProfileCard: manageable clubs → /host/clubs, others → public page; admins see only clubs they host', () => {
    const src = read('components/HostProfileCard.tsx')
    expect(src).toContain('href={c.canManage ? `/host/clubs/${c.slug}` : `/clubs/${c.slug}`}')
    expect(src).toContain("const myClubs  = user.role === 'admin' ? clubs.filter(c => c.hosted) : clubs")
    expect(src).toContain('myClubs.slice(0, MAX_CLUB_CHIPS)')
    expect(src).toContain('data.eventsHeld')
    expect(src).not.toContain('eventsHosted')
  })
})
