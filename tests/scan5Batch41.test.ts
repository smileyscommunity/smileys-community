import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fifth scan, batch 41:
//   a. the reminders sweep's "you attended" nudges use the no-show sweep's
//      exemption rule (noShowExemptionReason): club hosts and admins/
//      moderators leave the check-in ratio's room, and — being exempt is not
//      proof of being there — are only nudged when scanned. The event's own
//      host and co-hosts still count as attended.
//   b. deletes of city-bound targets pass the city to writeAudit: the row
//      is gone by the time the audit resolver would look it up, so
//      event.delete (seen in production) and its siblings audited city-less.

const h = vi.hoisted(() => {
  // Every prisma.<model>.<method> is a vi.fn resolving null unless a test
  // says otherwise — so a lookup after the delete finds nothing, as in prod.
  let fns = new Map<string, any>()
  const fn = (key: string) => {
    if (!fns.has(key)) fns.set(key, vi.fn(async () => null))
    return fns.get(key)
  }
  const prisma: any = new Proxy({}, {
    get: (_t, model) => {
      if (typeof model !== 'string' || model === 'then') return undefined
      if (model.startsWith('$')) return fn(model)
      return new Proxy({}, { get: (_m, method) => typeof method === 'string' ? fn(`${model}.${method}`) : undefined })
    },
  })
  return {
    prisma,
    resetPrisma: () => { fns = new Map() },
    getSession:         vi.fn(),
    claimOnce:          vi.fn(),
    releaseClaim:       vi.fn(),
    createNotification: vi.fn(),
    citiesByToday:      vi.fn(),
    email: {
      sendReviewRequestEmail:  vi.fn(),
      sendListingExpiryEmail:  vi.fn(),
      sendEventCancelledEmail: vi.fn(),
      sendRefundEmail:         vi.fn(),
      sendPremiumUpgradeEmail: vi.fn(),
      recordEmailFailure:      vi.fn(),
    },
  }
})

vi.mock('@/lib/prisma',             () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',            () => ({ getSession: h.getSession }))
vi.mock('@/lib/rateLimit',          () => ({ rateLimit: vi.fn(async () => true), claimOnce: h.claimOnce, releaseClaim: h.releaseClaim }))
vi.mock('@/lib/notify',             () => ({ createNotification: h.createNotification, notifyNewEvent: vi.fn(async () => {}), notifyNewArticle: vi.fn(async () => {}) }))
vi.mock('@/lib/email',              () => h.email)
vi.mock('@/lib/city',               () => ({
  citiesByToday: h.citiesByToday, todayInCity: vi.fn(async () => '2026-09-14'), resolveCityId: vi.fn(async () => 'c-ist'),
  resolveTargetCityId: vi.fn(), getCityTz: vi.fn(async () => 'Europe/Istanbul'), DEFAULT_CITY_SLUG: 'istanbul',
}))
vi.mock('@/lib/cronHealth',         () => ({ recordCronRun: vi.fn() }))
vi.mock('@/lib/noShow',             () => ({ waiveCard: vi.fn(async () => {}) }))
vi.mock('@/lib/spotsLeft',          () => ({ recomputeSpotsLeft: vi.fn(async () => {}), expectedSpotsLeft: vi.fn(async () => 0) }))
vi.mock('@/lib/admin/userHistory',  () => ({ snapshotUserHistory: vi.fn(async () => ({})) }))
vi.mock('@/lib/survey',             () => ({ computeEventSurveyRollup: vi.fn(async () => new Map()), aggregateRollup: vi.fn(() => null) }))
vi.mock('@/lib/neighborhoodsDb',    () => ({ normalizeNeighborhoodInput: vi.fn(async (_c: string, v: string) => ({ ok: true, value: v })) }))
vi.mock('@/lib/newsletterDigest',   () => ({ buildWeeklyDigest: vi.fn(async () => null) }))
vi.mock('@/lib/cityLaunch',         () => ({ notifyCityLaunch: vi.fn(async () => ({ notified: 0, failed: 0 })) }))
vi.mock('@/lib/push',               () => ({ sendPushToUser: vi.fn() }))
vi.mock('@/lib/posthog-server',     () => ({ trackServer: vi.fn() }))
vi.mock('next/cache',               () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: (f: any) => f }))

import { GET as remindersGET } from '@/app/api/admin/cron/reminders/route'
import { DELETE as eventDELETE } from '@/app/api/admin/events/[id]/route'
import { DELETE as directoryDELETE } from '@/app/api/admin/directory/route'
import { DELETE as postDELETE } from '@/app/api/admin/posts/[id]/route'
import { DELETE as testimonialDELETE } from '@/app/api/admin/testimonials/[id]/route'
import { DELETE as guideEntryDELETE } from '@/app/api/admin/guide-entries/[id]/route'
import { DELETE as messageDELETE } from '@/app/api/admin/messages/[id]/route'
import { DELETE as paymentDELETE } from '@/app/api/admin/payments/route'
import { DELETE as userDELETE } from '@/app/api/admin/users/[id]/route'

const p = h.prisma
const admin = { id: 'a1', name: 'Admin', email: 'a@x', role: 'admin', cityId: 'c-ist', color: '#000', totpVerified: true }
const cronReq = () => new Request('http://x/api', { headers: { 'x-cron-secret': 'sek' } }) as any
const jsonReq = (body: unknown) => new Request('http://x/api', { method: 'DELETE', body: JSON.stringify(body) }) as any
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.resetPrisma()
  process.env.CRON_SECRET = 'sek'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
  h.getSession.mockResolvedValue(admin)
  h.claimOnce.mockResolvedValue(true)
  h.releaseClaim.mockResolvedValue(undefined)
  h.createNotification.mockResolvedValue(true)
  for (const f of Object.values(h.email)) f.mockResolvedValue(undefined)
  p.$transaction.mockImplementation(async (arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(p))
})
afterEach(() => vi.useRealTimers())

// ── a ──────────────────────────────────────────────────────────────────────
describe('a. reminders sweep: the no-show exemption rule, and who is nudged', () => {
  const person = (id: string, o: { role?: string; checkedIn?: boolean } = {}) => ({
    userId: id, status: 'approved', checkedIn: o.checkedIn ?? false, attendance: 'unknown', cancelledAt: null, cancelledBy: null,
    user: { id, name: id, email: `${id}@x`, role: o.role ?? 'member' },
  })
  const event = (attendees: any[], id = 'e1') => ({
    id, title: 'Walk', emoji: '🚶', date: '2026-09-13', time: '19:00', cityId: 'c1', hostId: 'host', status: 'archived',
    cohosts: [{ userId: 'co' }],
    club: { memberships: [{ userId: 'clubhost' }, { userId: 'clubhost2' }] },
    attendees,
  })
  const setup = (events: any[]) => {
    h.citiesByToday.mockImplementation(async (off = 0) => [{ date: ['2026-09-13', '2026-09-14', '2026-09-15'][off + 1], cityIds: ['c1'] }])
    p.city.findMany.mockResolvedValue([{ id: 'c1', timezone: 'Europe/Istanbul' }])
    p.event.updateMany.mockResolvedValue({ count: 0 })
    p.listing.updateMany.mockResolvedValue({ count: 0 })
    p.visitorAnnouncement.updateMany.mockResolvedValue({ count: 0 })
    p.listing.findMany.mockResolvedValue([])
    p.notification.findMany.mockResolvedValue([])
    p.notificationPreference.findMany.mockResolvedValue([])
    // archived (connections) + past (reviews) → yesterday's events; nothing upcoming
    p.event.findMany.mockImplementation(async ({ where }: any) => where.status === 'published' ? [] : events)
  }
  const recipients = (type: string) => h.createNotification.mock.calls.filter(c => c[1] === type).map(c => c[0]).sort()

  it('unscanned club hosts and moderators get no "you attended" nudge; scanned ones and the event\'s host/co-host do', async () => {
    // Room (non-exempt): m1 scanned, m2 and a host-ROLE member unscanned —
    // 1 of 3, not credible, so the unscanned members keep the benefit of the doubt.
    setup([event([
      person('host'), person('co'),
      person('clubhost', { role: 'host' }), person('clubhost2', { role: 'host', checkedIn: true }),
      person('mod', { role: 'moderator' }), person('adm', { role: 'admin', checkedIn: true }),
      person('m1', { checkedIn: true }), person('m2'), person('hostRole', { role: 'host' }),
    ])])
    const res = await remindersGET(cronReq())
    expect(res.status).toBe(200)
    const want = ['adm', 'clubhost2', 'co', 'host', 'hostRole', 'm1', 'm2']
    expect(recipients('review_request')).toEqual(want)
    expect(recipients('connection_suggestion')).toEqual(want)
    expect(h.email.sendReviewRequestEmail.mock.calls.map(c => c[0]).sort()).toEqual(want.map(u => `${u}@x`))
    expect(h.createNotification.mock.calls.find(c => c[1] === 'connection_suggestion')![3]).toContain('with 6 other members')
  })

  it('exempt seats leave the check-in ratio: 1 of 2 members scanned is credible, so the unscanned member is a no-show', async () => {
    // With club host / moderator / admin counted in the room this was 1 of 5
    // (not credible) and m2 was told "you attended".
    setup([event([
      person('m1', { checkedIn: true }), person('m2'),
      person('clubhost', { role: 'host' }), person('mod', { role: 'moderator' }), person('adm', { role: 'admin' }),
    ])])
    await remindersGET(cronReq())
    expect(recipients('review_request')).toEqual(['m1'])
    // one person who was there has nobody to connect with
    expect(recipients('connection_suggestion')).toEqual([])
  })

  it('a host ROLE attending someone else\'s event is in the room like any member', async () => {
    setup([event([person('m1', { checkedIn: true }), person('visitingHost', { role: 'host' })])])
    await remindersGET(cronReq())
    expect(recipients('review_request')).toEqual(['m1'])
  })

  it('reads club hosts and roles in the two event queries — no per-event or per-attendee lookups', async () => {
    setup([event([person('m1', { checkedIn: true }), person('clubhost', { role: 'host' })], 'e1'), event([person('m2', { checkedIn: true })], 'e2')])
    await remindersGET(cronReq())
    const clubHosts = { select: { isActive: true, memberships: { where: { role: 'host', status: 'approved' }, select: { userId: true } } } }
    const calls = p.event.findMany.mock.calls.map((c: any) => c[0])
    expect(calls).toHaveLength(3)
    const connections = calls.find((a: any) => a.where.status === 'archived')
    const past        = calls.find((a: any) => a.where.status?.in)
    expect(connections.include.club).toEqual(clubHosts)
    expect(connections.include.attendees.select.user).toEqual({ select: { role: true } })
    expect(past.include.club).toEqual(clubHosts)
    expect(past.include.attendees.include.user.select.role).toBe(true)
    expect(p.clubMembership.findMany).not.toHaveBeenCalled()
    expect(p.user.findMany).not.toHaveBeenCalled()
    expect(p.user.findUnique).not.toHaveBeenCalled()
  })
})

// ── b ──────────────────────────────────────────────────────────────────────
describe('b. deletes audit under the deleted row\'s city', () => {
  const auditRow = async (action: string) => {
    await vi.waitFor(() => expect(p.auditLog.create.mock.calls.some((c: any) => c[0].data.action === action)).toBe(true))
    return p.auditLog.create.mock.calls.find((c: any) => c[0].data.action === action)[0].data
  }

  it('event.delete', async () => {
    // findUnique answers once (the route's scope read); the resolver's later lookup finds nothing
    p.event.findUnique.mockResolvedValueOnce({ hostId: 'h', cityId: 'c-izm', title: 'Picnic', date: '2026-09-20' })
    p.eventAttendee.count.mockResolvedValue(0)
    p.payment.count.mockResolvedValue(0)
    p.noShowCard.findMany.mockResolvedValue([])
    p.payment.findMany.mockResolvedValue([])
    const res = await eventDELETE({} as any, params('e1'))
    expect(res.status).toBe(200)
    expect(p.event.delete).toHaveBeenCalledWith({ where: { id: 'e1' } })
    expect((await auditRow('event.delete')).cityId).toBe('c-izm')
  })

  it('directory.delete', async () => {
    p.business.findUnique.mockResolvedValueOnce({ name: 'Cafe', cityId: 'c-izm' })
    p.businessReport.findMany.mockResolvedValue([])
    p.businessClaim.findMany.mockResolvedValue([])
    const res = await directoryDELETE(jsonReq({ id: 'b1' }))
    expect(res.status).toBe(200)
    expect((await auditRow('directory.delete')).cityId).toBe('c-izm')
  })

  it('post.delete', async () => {
    p.post.findUnique.mockResolvedValueOnce({ title: 'T', status: 'draft', category: 'guide', authorId: 'a1', publishedAt: null, cityId: 'c-izm' })
    const res = await postDELETE({} as any, params('p1'))
    expect(res.status).toBe(200)
    expect((await auditRow('post.delete')).cityId).toBe('c-izm')
  })

  it('testimonial.delete — a city quote keeps its city, a global one stays null', async () => {
    p.testimonial.findUnique.mockResolvedValueOnce({ memberName: 'Ana', role: 'nomad', quote: 'q', category: 'x', active: true, cityId: 'c-izm' })
    expect((await testimonialDELETE({} as any, params('t1'))).status).toBe(200)
    expect((await auditRow('testimonial.delete')).cityId).toBe('c-izm')

    p.auditLog.create.mockClear()
    p.testimonial.findUnique.mockResolvedValueOnce({ memberName: 'Bo', role: 'local', quote: 'q', category: 'x', active: true, cityId: null })
    expect((await testimonialDELETE({} as any, params('t2'))).status).toBe(200)
    expect((await auditRow('testimonial.delete')).cityId).toBeNull()
  })

  it('guide_entry_delete', async () => {
    p.guideEntry.findUnique.mockResolvedValueOnce({ id: 'g1', cityId: 'c-izm', slug: 'kart', title: 'Kart', city: { slug: 'izmir' } })
    const res = await guideEntryDELETE({} as any, params('g1'))
    expect(res.status).toBe(200)
    expect((await auditRow('guide_entry_delete')).cityId).toBe('c-izm')
  })

  it('message.delete (no resolver case for eventMessage at all)', async () => {
    p.eventMessage.findUnique.mockResolvedValueOnce({ id: 'm1', userId: 'u1', eventId: 'e1', message: 'hello', event: { cityId: 'c-izm' } })
    const res = await messageDELETE({} as any, params('m1'))
    expect(res.status).toBe(200)
    expect((await auditRow('message.delete')).cityId).toBe('c-izm')
  })

  it('payment.delete', async () => {
    p.payment.findUnique.mockResolvedValueOnce({
      id: 'pay1', amount: 500, currency: 'TRY', status: 'pending', method: null, notes: null, createdAt: new Date('2026-09-01T00:00:00Z'),
      userId: 'u1', eventId: 'e1', user: { email: 'u@x', name: 'U' }, event: { title: 'Picnic', cityId: 'c-izm' },
    })
    const res = await paymentDELETE(jsonReq({ id: 'pay1' }))
    expect(res.status).toBe(200)
    expect((await auditRow('payment.delete')).cityId).toBe('c-izm')
  })

  it('user.remove', async () => {
    p.user.findUnique.mockResolvedValueOnce({ name: 'Gone', email: 'g@x', cityId: 'c-izm' })
    p.payment.findMany.mockResolvedValue([])
    p.clubMembership.findMany.mockResolvedValue([])
    p.post.count.mockResolvedValue(0)
    p.newsletter.count.mockResolvedValue(0)
    p.event.count.mockResolvedValue(0)
    p.eventAttendee.findMany.mockResolvedValue([])
    const res = await userDELETE({} as any, params('u9'))
    expect(res.status).toBe(200)
    expect(p.user.delete).toHaveBeenCalledWith({ where: { id: 'u9' } })
    expect((await auditRow('user.remove')).cityId).toBe('c-izm')
  })
})
