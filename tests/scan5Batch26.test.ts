import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fifth scan, batch 26 (item 89) — the sweeps and the seat side-effects:
//   a. "you attended" review / connection nudges skip confirmed no-shows
//   b. the reconfirmation ask says today / tomorrow / a weekday, per city
//   c. sweep-hangouts and sweep-event-surveys claim per recipient, release
//      a failed send, and can't double-send across overlapping runs
//   d. member discovery's host pool uses the city's day and the city's events
//   e. a hangout no-show is counted once per member per hangout
//   f. a waitlist claim gets the payment row, host notice and confirmation
//      email a straight RSVP gets

const h = vi.hoisted(() => {
  const prisma = {
    $transaction:           vi.fn(),
    $queryRaw:              vi.fn(),
    city:                   { findMany: vi.fn(), findUnique: vi.fn() },
    event:                  { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    listing:                { updateMany: vi.fn(), findMany: vi.fn() },
    visitorAnnouncement:    { updateMany: vi.fn() },
    notification:           { findMany: vi.fn() },
    notificationPreference: { findMany: vi.fn() },
    hangout:                { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    hangoutReference:       { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    user:                   { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    memberBlock:            { findMany: vi.fn() },
    memberConnection:       { findMany: vi.fn() },
    eventAttendee:          { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    eventCoHost:            { findMany: vi.fn(), findFirst: vi.fn() },
    waitlistEntry:          { findUnique: vi.fn(), delete: vi.fn(), create: vi.fn(), count: vi.fn() },
    payment:                { create: vi.fn(), findFirst: vi.fn() },
  }
  return {
    prisma,
    getSession:         vi.fn(),
    rateLimit:          vi.fn(),
    claimOnce:          vi.fn(),
    releaseClaim:       vi.fn(),
    createNotification: vi.fn(),
    email: {
      sendReviewRequestEmail:    vi.fn(),
      sendListingExpiryEmail:    vi.fn(),
      sendReconfirmEmail:        vi.fn(),
      sendSpotReleasedEmail:     vi.fn(),
      sendRsvpConfirmationEmail: vi.fn(),
      sendSpotOpenedEmail:       vi.fn(),
      recordEmailFailure:        vi.fn(),
    },
    city: {
      citiesByToday: vi.fn(),
      resolveCityId: vi.fn(),
      getCityTz:     vi.fn(),
      todayInCity:   vi.fn(),
    },
  }
})

vi.mock('@/lib/prisma',         () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',        () => ({ getSession: h.getSession }))
vi.mock('@/lib/rateLimit',      () => ({ rateLimit: h.rateLimit, claimOnce: h.claimOnce, releaseClaim: h.releaseClaim }))
vi.mock('@/lib/notify',         () => ({ createNotification: h.createNotification }))
// The references route refuses a blocked pair (profile review 2026-09-19).
vi.mock('@/lib/memberPrivacy',  () => ({ isBlockedEitherWay: vi.fn(async () => false) }))
vi.mock('@/lib/email',          () => h.email)
vi.mock('@/lib/city',           () => h.city)
vi.mock('@/lib/access',         () => ({ isAdmin: vi.fn(() => false) }))
vi.mock('@/lib/cronHealth',     () => ({ recordCronRun: vi.fn() }))
vi.mock('@/lib/push',           () => ({ sendPushToUser: vi.fn() }))
vi.mock('@/lib/spotOpened',     () => ({ announceSpotOpened: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/spotsLeft',      () => ({ recomputeSpotsLeft: vi.fn(), expectedSpotsLeft: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/eventQuota',     () => ({ hasQuotaRoomFor: vi.fn().mockResolvedValue({ ok: true }), quotaEventSelect: {}, countSeatableFromWaitlist: vi.fn() }))
vi.mock('@/lib/reconfirmToken', () => ({ reconfirmUrl: () => 'https://x/confirm' }))
vi.mock('@/lib/autoJoinClub',   () => ({ autoJoinClub: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/firstEvent',     () => ({ stampFirstEventRsvp: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/posthog-server', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/noShow', () => ({
  checkRsvpAllowed: vi.fn().mockResolvedValue({ ok: true }), getRsvpGate: vi.fn(), gateErrorBody: vi.fn(), recordYellowAcknowledgement: vi.fn(),
}))
vi.mock('@/lib/sharedContext', () => ({
  loadViewerFacts:  vi.fn().mockResolvedValue({ clubIds: new Set(), eventIds: new Set(), neighborhood: null }),
  sharedContextFor: vi.fn().mockResolvedValue(new Map()),
  contextLabel:     vi.fn(() => null),
}))

import { GET as remindersGET } from '@/app/api/admin/cron/reminders/route'
import { POST as hangoutsSweep } from '@/app/api/cron/sweep-hangouts/route'
import { POST as surveysSweep } from '@/app/api/cron/sweep-event-surveys/route'
import { GET as discoveryGET } from '@/app/api/members/discovery/route'
import { POST as referencePOST } from '@/app/api/hangouts/[id]/references/route'
import { POST as rsvpPOST } from '@/app/api/events/[id]/rsvp/route'
import { dayPhrase, askEvent } from '@/lib/reconfirm'

const p = h.prisma as any
const cronReq = () => new Request('http://x/api', { headers: { 'x-cron-secret': 'sek', authorization: 'Bearer sek' } }) as any

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'sek'
  vi.useFakeTimers({ toFake: ['Date'] })
  h.claimOnce.mockResolvedValue(true)
  h.releaseClaim.mockResolvedValue(undefined)
  h.rateLimit.mockResolvedValue(true)
  h.createNotification.mockResolvedValue(true)
  for (const f of Object.values(h.email)) f.mockResolvedValue(undefined)
  p.$transaction.mockImplementation(async (arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(p))
  p.$queryRaw.mockResolvedValue([])
  p.city.findMany.mockResolvedValue([{ id: 'c1', timezone: 'Europe/Istanbul' }])
  p.city.findUnique.mockResolvedValue({ name: 'Istanbul' })
})
afterEach(() => vi.useRealTimers())

// ── a ──────────────────────────────────────────────────────────────────────
describe('a. reminders sweep: no "you attended" nudges for no-shows', () => {
  const person = (id: string, o: any = {}) => ({
    userId: id, status: 'approved', checkedIn: false, attendance: 'unknown', cancelledAt: null, cancelledBy: null,
    user: { id, name: id, email: `${id}@x` }, ...o,
  })
  const setup = (attendees: any[]) => {
    const ev = { id: 'e1', title: 'Walk', emoji: '🚶', date: '2026-09-13', time: '19:00', cityId: 'c1', hostId: 'host', status: 'archived', cohosts: [], attendees }
    h.city.citiesByToday.mockImplementation(async (off = 0) => [{ date: ['2026-09-13', '2026-09-14', '2026-09-15'][off + 1], cityIds: ['c1'] }])
    p.event.updateMany.mockResolvedValue({ count: 0 })
    p.listing.updateMany.mockResolvedValue({ count: 0 })
    p.visitorAnnouncement.updateMany.mockResolvedValue({ count: 0 })
    p.listing.findMany.mockResolvedValue([])
    p.notification.findMany.mockResolvedValue([])
    p.notificationPreference.findMany.mockResolvedValue([])
    p.event.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'published' ? [] : [ev])   // archived (connections) + past (reviews) → yesterday's event
  }
  const recipients = (type: string) => h.createNotification.mock.calls.filter(c => c[1] === type).map(c => c[0]).sort()

  it('skips a settled no-show, keeps a scanned member even if marked no_show', async () => {
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
    // 2 of 5 checked in: below the credible share, so the unstamped 'c'
    // and 'e' still count; only the stamped 'b' is out
    setup([person('a', { checkedIn: true }), person('b', { attendance: 'no_show' }), person('c'), person('d', { checkedIn: true, attendance: 'no_show' }), person('e')])
    const res = await remindersGET(cronReq())
    expect(res.status).toBe(200)
    expect(recipients('review_request')).toEqual(['a', 'c', 'd', 'e'])
    expect(recipients('connection_suggestion')).toEqual(['a', 'c', 'd', 'e'])
    expect(h.email.sendReviewRequestEmail.mock.calls.map(c => c[0]).sort()).toEqual(['a@x', 'c@x', 'd@x', 'e@x'])
    // "with N other members" counts the people who were there
    const body = h.createNotification.mock.calls.find(c => c[1] === 'connection_suggestion')![3]
    expect(body).toContain('with 3 other members')
  })

  it('reads an unscanned seat as a no-show once check-in was credible, before the sweep stamps it', async () => {
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
    setup([person('a', { checkedIn: true }), person('c'), person('d', { checkedIn: true })])
    await remindersGET(cronReq())
    expect(recipients('review_request')).toEqual(['a', 'd'])
  })
})

// ── b ──────────────────────────────────────────────────────────────────────
describe('b. reconfirmation wording follows the event date in the city', () => {
  it('today / tomorrow / weekday against the city calendar', () => {
    // 22:30 UTC on the 13th is already the 14th in Istanbul
    const now = new Date('2026-09-13T22:30:00Z')
    expect(dayPhrase('2026-09-14', 'Europe/Istanbul', now)).toBe('today')
    expect(dayPhrase('2026-09-15', 'Europe/Istanbul', now)).toBe('tomorrow')
    expect(dayPhrase('2026-09-14', 'UTC', now)).toBe('tomorrow')
    expect(dayPhrase('2026-09-16', 'Europe/Istanbul', now)).toBe('on Wednesday')
  })

  it('an ask that lands on the event day says "today" in the bell and the email', async () => {
    p.eventCoHost.findMany.mockResolvedValue([])
    p.eventAttendee.findMany.mockResolvedValue([{ id: 'r1', userId: 'a', user: { id: 'a', name: 'A', email: 'a@x' } }])
    p.eventAttendee.update.mockResolvedValue({})
    const ev = { id: 'e1', title: 'Late Jazz', emoji: '🎷', hostId: 'host', date: '2026-09-14', time: '23:30' }
    const startsAt = new Date('2026-09-14T20:30:00Z')
    const now = new Date('2026-09-14T06:00:00Z')   // 09:00 Istanbul, same day, inside the ask window
    await askEvent(ev, startsAt, 'Europe/Istanbul', now)
    expect(h.createNotification.mock.calls[0][2]).toBe('🎷 Still coming to Late Jazz today?')
    expect(h.email.sendReconfirmEmail.mock.calls[0][9]).toBe('today')
  })
})

// ── c ──────────────────────────────────────────────────────────────────────
describe('c. hangouts + event-surveys sweeps claim once per recipient', () => {
  // A real once-only store: the first claim of a key wins until released.
  const useClaimStore = () => {
    const taken = new Set<string>()
    h.claimOnce.mockImplementation(async (k: string) => taken.has(k) ? false : (taken.add(k), true))
    h.releaseClaim.mockImplementation(async (k: string) => { taken.delete(k) })
    return taken
  }

  it('two overlapping hangout sweeps push each person once', async () => {
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
    useClaimStore()
    const soon = { id: 'hg1', userId: 'host', title: 'Coffee', location: 'Moda', startsAt: new Date('2026-09-14T10:20:00Z'),
                   user: { id: 'host', name: 'Host' }, joins: [{ userId: 'j1' }, { userId: 'j2' }] }
    const done = { ...soon, id: 'hg2', startsAt: new Date('2026-09-14T07:00:00Z'), endsAt: new Date('2026-09-14T09:00:00Z') }
    p.hangout.findMany.mockImplementation(async ({ where }: any) => where.notifiedStartingAt === null ? [soon] : [done])
    p.hangout.update.mockResolvedValue({})
    await Promise.all([hangoutsSweep(cronReq()), hangoutsSweep(cronReq())])
    const starting = h.createNotification.mock.calls.filter(c => c[1] === 'hangout_starting').map(c => c[0]).sort()
    const recap    = h.createNotification.mock.calls.filter(c => c[1] === 'hangout_recap').map(c => c[0]).sort()
    expect(starting).toEqual(['host', 'j1', 'j2'])
    expect(recap).toEqual(['host', 'j1', 'j2'])
  })

  it('a failed hangout ping releases its claim and leaves the hangout unstamped for the retry', async () => {
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
    const taken = useClaimStore()
    const soon = { id: 'hg1', userId: 'host', title: 'Coffee', location: 'Moda', startsAt: new Date('2026-09-14T10:20:00Z'),
                   user: { id: 'host', name: 'Host' }, joins: [{ userId: 'j1' }] }
    p.hangout.findMany.mockImplementation(async ({ where }: any) => where.notifiedStartingAt === null ? [soon] : [])
    h.createNotification.mockImplementation(async (uid: string) => uid !== 'j1')
    await hangoutsSweep(cronReq())
    const j1Key = `hangout-starting:hg1:${soon.startsAt.getTime()}:j1`
    expect(h.releaseClaim).toHaveBeenCalledWith(j1Key)
    expect(taken.has(j1Key)).toBe(false)
    expect(p.hangout.update).not.toHaveBeenCalled()

    // retry: only j1 is pushed again, then the stamp lands
    h.createNotification.mockClear().mockResolvedValue(true)
    await hangoutsSweep(cronReq())
    expect(h.createNotification.mock.calls.map(c => c[0])).toEqual(['j1'])
    expect(p.hangout.update).toHaveBeenCalledWith({ where: { id: 'hg1' }, data: { notifiedStartingAt: expect.any(Date) } })
  })

  it('two overlapping survey sweeps ask each attendee once; a failure retries alone', async () => {
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
    useClaimStore()
    const ev = { id: 'e1', title: 'Walk', emoji: '🚶', date: '2026-09-12', time: '19:00', endTime: null, hostId: 'host', cityId: 'c1' }
    p.event.findMany.mockImplementation(async ({ where }: any) => where.surveyDispatchedAt === null ? [ev] : [])
    p.eventAttendee.findMany.mockResolvedValue([{ userId: 'a' }, { userId: 'b' }])
    p.eventCoHost.findMany.mockResolvedValue([])
    p.event.update.mockResolvedValue({})
    h.createNotification.mockImplementation(async (uid: string) => uid !== 'b')
    await Promise.all([surveysSweep(cronReq()), surveysSweep(cronReq())])
    expect(h.createNotification.mock.calls.map(c => c[0]).sort()).toEqual(['a', 'b'])   // b tried once by the winner, failed
    expect(h.releaseClaim).toHaveBeenCalledWith('event-survey:e1:b')
    expect(p.event.update).not.toHaveBeenCalled()

    h.createNotification.mockClear().mockResolvedValue(true)
    await surveysSweep(cronReq())
    expect(h.createNotification.mock.calls.map(c => c[0])).toEqual(['b'])
    expect(p.event.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { surveyDispatchedAt: expect.any(Date) } })
  })
})

// ── d ──────────────────────────────────────────────────────────────────────
describe('d. member discovery host pool', () => {
  it("uses the member's city day and only that city's events and clubs", async () => {
    // 21:30 UTC on the 14th = 01:30 on the 15th in Tbilisi
    vi.setSystemTime(new Date('2026-09-14T21:30:00Z'))
    h.getSession.mockResolvedValue({ id: 'me', cityId: 'tbilisi' })
    h.city.resolveCityId.mockResolvedValue('tbilisi')
    h.city.getCityTz.mockResolvedValue('Asia/Tbilisi')
    p.memberBlock.findMany.mockResolvedValue([])
    p.memberConnection.findMany.mockResolvedValue([])
    p.event.findMany.mockResolvedValue([{ hostId: 'hostT' }])
    p.user.findUnique.mockResolvedValue({ lookingFor: [] })
    p.user.findMany.mockResolvedValue([])
    const res = await discoveryGET()
    expect(res.status).toBe(200)
    expect(p.event.findMany.mock.calls[0][0].where).toEqual({ cityId: 'tbilisi', date: { gte: '2026-09-15' }, status: 'published' })
    const hostQuery = p.user.findMany.mock.calls.map(c => c[0].where).find((w: any) => w.AND)
    expect(hostQuery.cityId).toBe('tbilisi')
    expect(hostQuery.AND[0].OR).toEqual([
      { clubMemberships: { some: { role: 'host', status: 'approved', club: { OR: [{ cityId: 'tbilisi' }, { cityId: null }] } } } },
      { id: { in: ['hostT'] } },
    ])
  })
})

// ── e ──────────────────────────────────────────────────────────────────────
describe('e. hangout no-shows count once per member per hangout', () => {
  let refs: any[]
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
    refs = []
    p.hangout.findUnique.mockImplementation(async ({ where }: any) => ({
      id: where.id, userId: 'host', endsAt: new Date('2026-09-13T20:00:00Z'), status: 'expired', title: 'Coffee',
      joins: [{ userId: 'j1' }, { userId: 'j2' }],
    }))
    p.hangoutReference.findUnique.mockImplementation(async ({ where }: any) => {
      const k = where.hangoutId_fromUserId_toUserId
      return refs.find(r => r.hangoutId === k.hangoutId && r.fromUserId === k.fromUserId && r.toUserId === k.toUserId) ?? null
    })
    p.hangoutReference.create.mockImplementation(async ({ data }: any) => { const r = { id: `r${refs.length}`, ...data }; refs.push(r); return r })
    p.hangoutReference.update.mockImplementation(async ({ where, data }: any) => Object.assign(refs.find(r => r.id === where.id), data))
    // distinct on hangoutId, as Postgres would
    p.hangoutReference.findMany.mockImplementation(async ({ where, distinct }: any) => {
      const rows = refs.filter(r => r.toUserId === where.toUserId && r.vibe === where.vibe)
      expect(distinct).toEqual(['hangoutId'])
      return [...new Map(rows.map(r => [r.hangoutId, r])).values()]
    })
    p.user.update.mockResolvedValue({})
  })
  const report = async (from: string, hangoutId: string, vibe: string) => {
    h.getSession.mockResolvedValue({ id: from, name: from })
    const req = { json: async () => ({ toUserId: 'host', vibe }) } as any
    return referencePOST(req, { params: Promise.resolve({ id: hangoutId }) })
  }
  const lastCount = () => p.user.update.mock.calls.at(-1)[0].data.noShowCount

  it('two joiners reporting the same hangout make one no-show, not two', async () => {
    await report('j1', 'hg1', 'no_show')
    expect(lastCount()).toBe(1)
    await report('j2', 'hg1', 'no_show')
    expect(lastCount()).toBe(1)
    expect(p.user.update.mock.calls.every((c: any) => !('increment' in Object(c[0].data.noShowCount)))).toBe(true)
  })

  it('a repeat report by the same member changes nothing; withdrawing all reports clears it', async () => {
    await report('j1', 'hg1', 'no_show')
    p.user.update.mockClear()
    await report('j1', 'hg1', 'no_show')
    expect(p.user.update).not.toHaveBeenCalled()
    expect(refs).toHaveLength(1)
    await report('j1', 'hg1', 'meh')
    expect(lastCount()).toBe(0)
  })

  it('a different hangout is a different no-show', async () => {
    await report('j1', 'hg1', 'no_show')
    await report('j1', 'hg2', 'no_show')
    expect(lastCount()).toBe(2)
  })
})

// ── f ──────────────────────────────────────────────────────────────────────
describe('f. a waitlist claim has the same side effects as a straight RSVP', () => {
  const event = {
    id: 'e1', title: 'Wine Night', hostId: 'host', cityId: 'c1', status: 'published', cancelledAt: null,
    date: '2026-09-20', time: '19:00', endTime: null, registrationDeadline: null, totalSpots: 20, spotsLeft: 1, limitedSpots: true,
    approvalRequired: false, price: 400, memberPrice: null, currency: 'TRY', payTo: 'smileys', soldOut: false, genderBalance: false,
    location: 'Karaköy', neighborhood: null, maleQuota: null, femaleQuota: null, turkishMaleQuota: null,
  }
  const params = { params: Promise.resolve({ id: 'e1' }) }
  const req = { json: async () => ({}) } as any

  beforeEach(() => {
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
    h.getSession.mockResolvedValue({ id: 'u1', name: 'Uma', email: 'u@x', role: 'member' })
    h.city.todayInCity.mockResolvedValue('2026-09-14')
    h.city.getCityTz.mockResolvedValue('Europe/Istanbul')
    h.createNotification.mockResolvedValue(undefined)
    p.event.findUnique.mockResolvedValue(event)
    p.event.updateMany.mockResolvedValue({ count: 1 })
    p.user.findUnique.mockResolvedValue({ status: 'approved', gender: 'female', nationality: 'Germany', email: 'u@x', name: 'Uma' })
    p.eventCoHost.findFirst.mockResolvedValue(null)
    p.eventAttendee.findUnique.mockResolvedValue(null)
    p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
    p.eventAttendee.create.mockResolvedValue({})
    p.waitlistEntry.delete.mockResolvedValue({})
    p.payment.create.mockResolvedValue({})
  })

  const sideEffects = async () => {
    await vi.waitFor(() => expect(h.email.sendRsvpConfirmationEmail).toHaveBeenCalled())
    return {
      payment: p.payment.create.mock.calls.map((c: any) => c[0].data),
      host:    h.createNotification.mock.calls.filter(c => c[0] === 'host').map(c => [c[1], c[4]]),
      email:   h.email.sendRsvpConfirmationEmail.mock.calls[0].slice(0, 6),
    }
  }

  it('claim: pending payment on the claim transaction, host notice, confirmation email', async () => {
    p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1' })
    const res = await rsvpPOST(req, params)
    expect((await res.json()).status).toBe('approved')
    expect(p.waitlistEntry.delete).toHaveBeenCalledWith({ where: { id: 'w1' } })
    const claim = await sideEffects()
    expect(claim).toEqual({
      payment: [{ userId: 'u1', eventId: 'e1', amount: 400, currency: 'TRY', status: 'pending' }],
      host:    [['attendee_joined', '/host/events/e1/participants']],
      email:   ['u@x', 'Uma', 'Wine Night', '2026-09-20', 'Karaköy', 'e1'],
    })
    // the claim keeps its own member-facing wording
    expect(h.createNotification).toHaveBeenCalledWith('u1', 'rsvp', "You're in! 🎉", 'You claimed the open spot for "Wine Night".', '/events/e1')

    // …and matches the straight RSVP exactly
    vi.clearAllMocks()
    p.$transaction.mockImplementation(async (arg: any) => arg(p))
    p.waitlistEntry.findUnique.mockResolvedValue(null)
    h.email.sendRsvpConfirmationEmail.mockResolvedValue(undefined)
    await rsvpPOST(req, params)
    expect(await sideEffects()).toEqual(claim)
  })

  it('a claim that loses the race writes no payment and sends nothing', async () => {
    p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1' })
    p.event.updateMany.mockResolvedValue({ count: 0 })
    const res = await rsvpPOST(req, params)
    expect(res.status).toBe(409)
    expect(p.payment.create).not.toHaveBeenCalled()
    await new Promise(r => setTimeout(r, 0))
    expect(h.email.sendRsvpConfirmationEmail).not.toHaveBeenCalled()
  })
})
