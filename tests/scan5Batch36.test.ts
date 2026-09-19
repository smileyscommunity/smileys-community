import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { NextRequest } from 'next/server'

// Fifth scan, batch 36 — from the 2026-09 read-only production audit.
//   103. 21 notifications reached a banned member in 30 days: createNotification,
//        sendPushToUser and the email send path now check the recipient.
//   104. a moderator's own no-show card was activated, and cards were
//        overturned for the club hosts of their event: one exemption rule
//        (runners + staff), a conflict-of-interest rule on every review path,
//        and a read-only audit script.

const read = (p: string) => readFileSync(p, 'utf-8')

const h = vi.hoisted(() => ({
  prisma: {
    user:                   { findUnique: vi.fn(), findMany: vi.fn() },
    notificationPreference: { findUnique: vi.fn() },
    notification:           { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    pushSubscription:       { findMany: vi.fn(), deleteMany: vi.fn() },
    noShowCard:             { findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
    event:                  { findUnique: vi.fn(), update: vi.fn() },
    eventAttendee:          { findMany: vi.fn(), updateMany: vi.fn() },
    $transaction:           vi.fn(),
  },
  sendNotification: vi.fn(),
  resendSend:       vi.fn(),
  batchSend:        vi.fn(),
  session:          { current: null as null | { id: string; role: string; cityId: string; name: string } },
  resolveCard:      vi.fn(),
  waiveCard:        vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: h.sendNotification } }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.resendSend }
    batch  = { send: h.batchSend }
  },
}))
vi.mock('@/lib/unsubscribe', () => ({
  unsubscribeUrl:         () => 'https://example.test/unsub',
  oneClickUnsubscribeUrl: () => 'https://example.test/unsub-1c',
}))
vi.mock('@/lib/city', () => ({ getCityTz: vi.fn(async () => 'Europe/Istanbul') }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => h.session.current) }))
vi.mock('@/lib/access', async (orig) => ({
  ...(await orig<typeof import('@/lib/access')>()),
  canManageEventOps: vi.fn(async () => true),
}))
vi.mock('@/lib/noShow', async (orig) => ({
  ...(await orig<typeof import('@/lib/noShow')>()),
  resolveCard: h.resolveCard,
  waiveCard:   h.waiveCard,
}))

process.env.RESEND_API_KEY = 'test-key'

beforeEach(() => {
  for (const model of Object.values(h.prisma)) {
    if (typeof model === 'function') (model as ReturnType<typeof vi.fn>).mockReset()
    else for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset()
  }
  for (const fn of [h.sendNotification, h.resendSend, h.batchSend, h.resolveCard, h.waiveCard]) fn.mockReset()
  h.prisma.notification.create.mockResolvedValue({ id: 'n1' })
  h.prisma.notificationPreference.findUnique.mockResolvedValue(null)
  h.prisma.pushSubscription.findMany.mockResolvedValue([{ id: 's1', endpoint: 'https://push.test/1', p256dh: 'k', auth: 'a' }])
  h.prisma.user.findMany.mockResolvedValue([])
  h.sendNotification.mockResolvedValue({})
  h.resendSend.mockResolvedValue({ data: { id: 'm1' }, error: null })
  h.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(h.prisma))
  h.resolveCard.mockResolvedValue('ok')
  h.waiveCard.mockResolvedValue('ok')
})

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const PAST   = new Date(Date.now() - 24 * 60 * 60 * 1000)
const flush  = () => new Promise(r => setTimeout(r, 0))

// ── 103. notifications ─────────────────────────────────────────────────────
describe('103 createNotification skips accounts that may not receive it', () => {
  it('a banned member: handled (true), no bell row, no push', async () => {
    const { createNotification } = await import('@/lib/notify')
    h.prisma.user.findUnique.mockResolvedValue({ status: 'banned', suspendedUntil: null, cityId: 'c1' })
    await expect(createNotification('u1', 'rsvp', 't', 'b', '/events/e1')).resolves.toBe(true)
    await flush()
    expect(h.prisma.notification.create).not.toHaveBeenCalled()
    expect(h.prisma.pushSubscription.findMany).not.toHaveBeenCalled()
  })

  it('a user that no longer exists: handled, nothing written', async () => {
    const { createNotification } = await import('@/lib/notify')
    h.prisma.user.findUnique.mockResolvedValue(null)
    await expect(createNotification('gone', 'warning', 't', 'b')).resolves.toBe(true)
    expect(h.prisma.notification.create).not.toHaveBeenCalled()
  })

  it('suspended: social and broadcast types skipped, account and commitment notices delivered', async () => {
    const { createNotification } = await import('@/lib/notify')
    h.prisma.user.findUnique.mockResolvedValue({ status: 'approved', suspendedUntil: FUTURE, cityId: 'c1' })
    for (const type of ['new_event', 'connection_request', 'message', 'announcement', 'report']) {
      await expect(createNotification('u1', type, 't', 'b')).resolves.toBe(true)
    }
    expect(h.prisma.notification.create).not.toHaveBeenCalled()
    for (const type of ['warning', 'no_show_red', 'event_cancelled', 'waitlist_promoted', 'reminder_24h']) {
      await createNotification('u1', type, 't', 'b')
    }
    expect(h.prisma.notification.create).toHaveBeenCalledTimes(5)
  })

  it('a suspension that has ended is no suspension', async () => {
    const { createNotification } = await import('@/lib/notify')
    h.prisma.user.findUnique.mockResolvedValue({ status: 'approved', suspendedUntil: PAST, cityId: 'c1' })
    await createNotification('u1', 'new_event', 't', 'b')
    expect(h.prisma.notification.create).toHaveBeenCalledTimes(1)
  })

  it('a caller holding the user row passes it: no lookup, same rule', async () => {
    const { createNotification } = await import('@/lib/notify')
    await createNotification('u1', 'rsvp', 't', 'b', undefined, { status: 'approved', suspendedUntil: null })
    expect(h.prisma.user.findUnique).not.toHaveBeenCalled()
    expect(h.prisma.notification.create).toHaveBeenCalledTimes(1)
    await expect(createNotification('u2', 'rsvp', 't', 'b', undefined, { status: 'banned' })).resolves.toBe(true)
    expect(h.prisma.notification.create).toHaveBeenCalledTimes(1)
  })

  it('an unreadable account fails open — the notice is delivered', async () => {
    const { createNotification } = await import('@/lib/notify')
    h.prisma.user.findUnique.mockRejectedValue(new Error('pool exhausted'))
    await expect(createNotification('u1', 'warning', 't', 'b')).resolves.toBe(true)
    expect(h.prisma.notification.create).toHaveBeenCalledTimes(1)
  })

  it('quiet hours reuse the recipient row: one user lookup, not two', async () => {
    const { createNotification } = await import('@/lib/notify')
    h.prisma.user.findUnique.mockResolvedValue({ status: 'approved', suspendedUntil: null, cityId: 'c1' })
    h.prisma.notificationPreference.findUnique.mockResolvedValue({ reminders: true, quietHours: true, quietFrom: 22, quietTo: 7 })
    await createNotification('u1', 'reminder_24h', 't', 'b', '/events/e1')
    expect(h.prisma.user.findUnique).toHaveBeenCalledTimes(1)
    expect(h.prisma.notification.create).toHaveBeenCalledTimes(1)
  })

  it('recipientSkipReason is the rule, pure', async () => {
    const { recipientSkipReason } = await import('@/lib/notify')
    expect(recipientSkipReason(null, 'rsvp')).toBe('missing')
    expect(recipientSkipReason({ status: 'banned' }, 'warning')).toBe('banned')
    expect(recipientSkipReason({ status: 'approved', suspendedUntil: FUTURE }, 'new_hangout')).toBe('suspended')
    expect(recipientSkipReason({ status: 'approved', suspendedUntil: FUTURE }, 'system_alert')).toBeNull()
    expect(recipientSkipReason({ status: 'approved', suspendedUntil: FUTURE }, 'some_new_type')).toBeNull()
    expect(recipientSkipReason({ status: 'approved' }, 'new_event')).toBeNull()
  })
})

describe('103 sendPushToUser never reaches a banned account', () => {
  // VAPID is configured on first send now, not at import, and a send without
  // keys returns before touching the database — so these tests, which are
  // about the QUERY, have to supply keys for the function to get that far.
  beforeEach(() => {
    process.env.VAPID_EMAIL = 'mailto:test@example.test'
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'BFakePublicKeyForTestsOnly_0000000000000000000000000000000000000000000000000000000000'
    process.env.VAPID_PRIVATE_KEY = 'fake-private-key-for-tests-only-0000000000'
  })

  it('filters subscriptions through the user relation — no extra round trip', async () => {
    const { sendPushToUser } = await import('@/lib/push')
    await sendPushToUser('u1', { title: 't', body: 'b' })
    expect(h.prisma.pushSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', user: { status: { notIn: ['banned', 'deleted'] } } },
    }))
    expect(h.prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('a banned member has no matching subscriptions, so nothing is sent', async () => {
    const { sendPushToUser } = await import('@/lib/push')
    h.prisma.pushSubscription.findMany.mockResolvedValue([])
    await sendPushToUser('banned1', { title: 't', body: 'b' })
    expect(h.sendNotification).not.toHaveBeenCalled()
  })
})

// ── 103. email ─────────────────────────────────────────────────────────────
describe('103 the email send path skips banned recipients', () => {
  it('a reminder to a banned address is not sent', async () => {
    const { sendEventReminderEmail } = await import('@/lib/email')
    h.prisma.user.findMany.mockResolvedValue([{ email: 'ban@example.test' }])
    await sendEventReminderEmail('u1', 'Ban@Example.test', 'Ban Ned', 'Walk', '🚶', '2026-09-20', 'Moda', 'e1')
    expect(h.resendSend).not.toHaveBeenCalled()
    expect(h.prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['banned', 'deleted'] } }),
    }))
  })

  it('a member in good standing still gets it', async () => {
    const { sendFirstEventNudgeEmail } = await import('@/lib/email')
    await sendFirstEventNudgeEmail('u1', 'ok@example.test', 'Ok Member',
      { id: 'e1', title: 'Walk', date: '2026-09-20', time: null, neighborhood: null, emoji: null, attendees: 0, isFirstTimerFriendly: false })
    expect(h.resendSend).toHaveBeenCalledTimes(1)
  })

  it('account mail a banned person must still receive: refund notice, email-changed notice', async () => {
    const { sendRefundEmail, sendEmailChangedNotice } = await import('@/lib/email')
    h.prisma.user.findMany.mockResolvedValue([{ email: 'ban@example.test' }])
    await sendRefundEmail('ban@example.test', 'Ban Ned', 'Walk', 300, 'TRY')
    await sendEmailChangedNotice('ban@example.test', 'Ban Ned', 'new@example.test')
    expect(h.resendSend).toHaveBeenCalledTimes(2)
    expect(h.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('a deleted account\'s ghost address is skipped without a lookup', async () => {
    const { sendReviewRequestEmail } = await import('@/lib/email')
    await sendReviewRequestEmail('abc@deleted.smileys', 'Deleted Member', 'Walk', '🚶')
    expect(h.resendSend).not.toHaveBeenCalled()
    expect(h.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('a failed lookup fails open: the mail goes', async () => {
    const { sendSpotOpenedEmail } = await import('@/lib/email')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.prisma.user.findMany.mockRejectedValue(new Error('db down'))
    await sendSpotOpenedEmail('ok@example.test', 'Ok', 'Walk', '2026-09-20', 'e1')
    expect(h.resendSend).toHaveBeenCalledTimes(1)
  })

  it('newsletter batches drop banned recipients before sending, so ids stay aligned', async () => {
    const { sendNewsletterBatch } = await import('@/lib/email')
    h.prisma.user.findMany.mockResolvedValue([{ email: 'ban@example.test' }])
    h.batchSend.mockResolvedValue({ data: { data: [{ id: 'r-ok' }] }, error: null })
    const out = await sendNewsletterBatch(
      [{ id: 'u1', email: 'ban@example.test', name: 'Ban' }, { id: 'u2', email: 'ok@example.test', name: 'Ok' }],
      'Subject', '<p>Hi</p>', 'nl1')
    expect(h.batchSend).toHaveBeenCalledTimes(1)
    expect(h.batchSend.mock.calls[0][0].map((p: { to: string }) => p.to)).toEqual(['ok@example.test'])
    expect(out).toEqual({ sent: 1, resendLogs: [{ newsletterId: 'nl1', resendId: 'r-ok' }], failed: [] })
  })
})

// ── 104a. the exemption rule ───────────────────────────────────────────────
describe('104a who is never carded', () => {
  const runners = { hostId: 'host', cohostIds: ['co'], clubHostIds: ['ch'] }

  it('runners and staff are exempt; a host ROLE attending as a member is not', async () => {
    const { noShowExemptionReason } = await import('@/lib/noShowPolicy')
    expect(noShowExemptionReason('host', 'member', runners)).toBe('event_host')
    expect(noShowExemptionReason('co', 'member', runners)).toBe('event_cohost')
    expect(noShowExemptionReason('ch', 'member', runners)).toBe('club_host')
    expect(noShowExemptionReason('mod', 'moderator', runners)).toBe('staff')
    expect(noShowExemptionReason('adm', 'admin', runners)).toBe('staff')
    expect(noShowExemptionReason('h2', 'host', runners)).toBeNull()
    expect(noShowExemptionReason('m', 'member', runners)).toBeNull()
    expect(noShowExemptionReason('m', undefined, runners)).toBeNull()
  })

  it('eventRunners reads the Prisma shape and treats a missing event as run by nobody', async () => {
    const { eventRunners } = await import('@/lib/noShowPolicy')
    expect(eventRunners({ hostId: 'h', cohosts: [{ userId: 'c' }], club: { memberships: [{ userId: 'k' }] } }))
      .toEqual({ hostId: 'h', cohostIds: ['c'], clubHostIds: ['k'] })
    expect(eventRunners(undefined)).toEqual({ hostId: null, cohostIds: [], clubHostIds: [] })
    expect(eventRunners({ hostId: 'h', cohosts: [], club: null }).clubHostIds).toEqual([])
  })

  it('settleEvent cards neither club hosts nor staff, and leaves them out of the check-in room', async () => {
    const { settleEvent } = await import('@/lib/noShow')
    h.prisma.event.findUnique.mockResolvedValue({
      id: 'e1', date: '2026-09-12', time: '19:00', endTime: '23:59', hostId: 'host', clubId: 'club1',
      price: 0, memberPrice: null, payTo: null, ticketUrl: null, paymentContact: null,
      status: 'archived', cancelledAt: null, noShowProcessedAt: null,
      city: { timezone: 'Europe/Istanbul' }, cohosts: [{ userId: 'co' }],
      club: { memberships: [{ userId: 'clubhost' }] },
    })
    const row = (id: string, role: string, o: object = {}) =>
      ({ id, userId: id, status: 'approved', checkedIn: false, cancelledAt: null, cancelledBy: null, user: { role }, ...o })
    h.prisma.eventAttendee.findMany.mockResolvedValue([
      row('p1', 'member', { checkedIn: true }), row('p2', 'member', { checkedIn: true }),
      row('absent', 'member'), row('hostrole', 'host'),
      row('clubhost', 'member'), row('mod', 'moderator'), row('adm', 'admin'), row('co', 'member'),
    ])
    h.prisma.noShowCard.findMany.mockResolvedValue([])
    h.prisma.noShowCard.createMany.mockResolvedValue({ count: 2 })
    // 2 of 4 checked in = credible. Counting the four exempt seats would make it 2 of 8 and skip.
    const r = await settleEvent('e1', new Date('2026-09-12T23:30:00Z'))
    expect(r.skipped).toBeUndefined()
    expect(r.noShows).toBe(2)
    const carded = h.prisma.noShowCard.createMany.mock.calls[0][0].data.map((c: { userId: string }) => c.userId)
    expect(carded.sort()).toEqual(['absent', 'hostrole'])
    expect(h.prisma.eventAttendee.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['absent', 'hostrole'] } }, data: { attendance: 'no_show' } })
  })
})

// ── 104b. conflict of interest ─────────────────────────────────────────────
// 104b's card-judging tests moved to standingReviewConflict.test.ts when v1's
// no-show cards route and page were deleted — the rule they protect is now
// enforced on standing's offence decision, and that is where it is covered.
// The host waiver below still has a live route, so it stays.
describe('104b a runner cannot clear their own card', () => {
  const MOD   = { id: 'm1', role: 'moderator', cityId: 'ist', name: 'Mod' }
  it('the host waiver refuses a runner clearing their own card', async () => {
    const { POST } = await import('@/app/api/events/[id]/no-shows/waive/route')
    const waive = () => POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ cardId: 'card1', reason: 'missed scan' }) }),
      { params: Promise.resolve({ id: 'e1' }) })
    h.session.current = { id: 'clubhost', role: 'member', cityId: 'ist', name: 'CH' }
    h.prisma.noShowCard.findUnique.mockResolvedValue({ eventId: 'e1', userId: 'clubhost' })
    expect((await waive()).status).toBe(403)
    expect(h.waiveCard).not.toHaveBeenCalled()
    h.prisma.noShowCard.findUnique.mockResolvedValue({ eventId: 'e1', userId: 'someone' })
    expect((await waive()).status).toBe(200)
    expect(h.waiveCard).toHaveBeenCalledTimes(1)
  })

})

// ── 104c. the audit script ─────────────────────────────────────────────────
describe('104c scripts/audit-noshow-cards-conflicts planning', () => {
  const person = (id: string, role: string | null = 'member') => ({ id, role, initials: id.slice(0, 2).toUpperCase() })
  const facts = (o: object) => ({
    cardId: 'c', kind: 'yellow', status: 'active', appealStatus: null,
    occurredAt: new Date('2026-09-01T20:00:00Z'), issuedAt: new Date('2026-09-01T23:00:00Z'), resolvedAt: null, waivedAt: null,
    holder: person('m'), eventId: 'e', eventTitle: 'Walk', eventDate: '2026-09-01',
    runners: { hostId: 'host', cohostIds: ['co'], clubHostIds: ['ch1', 'ch2'] },
    resolvedBy: null, waivedBy: null,
    ...o,
  })

  it('lists cards held by exempt people and reviews with a conflict — nothing else', async () => {
    const { planNoShowConflictAudit } = await import('@/scripts/audit-noshow-cards-conflicts')
    const plan = planNoShowConflictAudit([
      facts({ cardId: 'plain' }),
      facts({ cardId: 'modcard', kind: 'red', holder: person('mod', 'moderator') }),
      facts({ cardId: 'ch1card', status: 'overturned', holder: person('ch1'), resolvedBy: person('ch2', 'moderator') }),
      facts({ cardId: 'fairreview', status: 'overturned', resolvedBy: person('adm', 'admin') }),
      facts({ cardId: 'hostwaived', status: 'waived', waivedBy: person('host') }),
      facts({ cardId: 'selfwaived', status: 'waived', holder: person('ch2'), waivedBy: person('ch2') }),
    ])
    expect(plan.heldByExempt.map(r => [r.card.cardId, r.reason])).toEqual([
      ['modcard', 'staff'], ['ch1card', 'club_host'], ['selfwaived', 'club_host'],
    ])
    expect(plan.reviewConflicts.map(r => [r.card.cardId, r.via, r.conflict, r.reviewer.role])).toEqual([
      ['ch1card', 'resolved', 'club_host', 'moderator'],
      ['selfwaived', 'waived', 'own_card', 'member'],
    ])
    expect(plan.counts).toMatchObject({ cards: 6, heldByExempt: 3, reviewConflicts: 2, byReason: { staff: 1, club_host: 2 } })
  })

  it('is read-only: no write call anywhere in the script', () => {
    const src = read('scripts/audit-noshow-cards-conflicts.ts')
    expect(src).not.toMatch(/\.(update|updateMany|create|createMany|delete|deleteMany|upsert|\$executeRaw\w*)\(/)
    expect(src).not.toMatch(/APPLY|DRY_RUN/)
  })
})
