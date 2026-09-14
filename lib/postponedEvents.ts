import { prisma } from '@/lib/prisma'
import { citiesByToday } from '@/lib/city'

// ── Postponed events with no new date ───────────────────────────────────────
//
// Postponing pulls an event off the feed and tells the people going, and then
// nothing else ever looks at it: every sweep (reminders, reconfirm, no-shows,
// surveys, payment reminders) acts on published/archived events only, which
// is right — but it also means a postponed event with no new date holds its
// seats indefinitely. The production audit found 20 seats on one.
//
// The minimal fair handling, and deliberately no more:
//   - staff see them on the admin dashboard (count, seats, days postponed);
//   - the host is reminded once the event has sat a week with no new date and
//     someone still waiting on it, and again at most every two weeks
//     (lib/postponedReminder — kept apart so the dashboard's loader doesn't
//     pull in the notification/push stack);
//   - nothing is cancelled automatically. Only the host knows whether a date
//     is coming, and a wrong auto-cancel emails everyone "cancelled".
//
// "Postponed" has no timestamp of its own, so the audit trail supplies it: the
// last event.update whose diff moved status to 'postponed'. A date changed in
// or after that edit counts as a new date — unless that date has passed too.
// With no audit row, updatedAt stands in (a lower bound: any later edit moves
// it), and the row says so.

export const POSTPONED_REMIND_AFTER_DAYS = 7
export const POSTPONED_REREMIND_DAYS     = 14
const DAY_MS = 86_400_000

export interface PostponeAuditRow { createdAt: Date; meta: unknown }

function diffEntry(meta: unknown, field: string): { from?: unknown; to?: unknown } | null {
  if (!meta || typeof meta !== 'object') return null
  const diff = (meta as { diff?: unknown }).diff
  if (!diff || typeof diff !== 'object') return null
  const entry = (diff as Record<string, unknown>)[field]
  return entry && typeof entry === 'object' ? entry as { from?: unknown; to?: unknown } : null
}

/** Pure: when it was (last) postponed, whether that came from the audit trail, and whether a date was set since. */
export function postponedTimeline(rows: PostponeAuditRow[], fallback: Date): { postponedAt: Date; fromAudit: boolean; dateChangedSince: boolean } {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  let postponedAt: Date | null = null
  for (const r of sorted) if (diffEntry(r.meta, 'status')?.to === 'postponed') postponedAt = r.createdAt
  if (!postponedAt) return { postponedAt: fallback, fromAudit: false, dateChangedSince: false }
  const since = postponedAt.getTime()
  const dateChangedSince = sorted.some(r => {
    if (r.createdAt.getTime() < since) return false
    const d = diffEntry(r.meta, 'date')
    return !!d && typeof d.to === 'string' && d.to !== d.from
  })
  return { postponedAt, fromAudit: true, dateChangedSince }
}

export interface PostponedFacts {
  id:                   string
  title:                string
  emoji:                string
  date:                 string   // 'YYYY-MM-DD' — the date it was postponed from, unless changed since
  cityId:               string
  city:                 string
  cityToday:            string   // on the event city's clock
  hostId:               string
  seats:                number   // approved, host and co-hosts excluded
  pending:              number
  waitlist:             number
  paymentsPending:      number
  paymentsPendingTotal: number
  paymentsPaid:         number
  currency:             string
  updatedAt:            Date
  audit:                PostponeAuditRow[]
}

export interface PostponedRow extends PostponedFacts {
  postponedAt:        Date
  fromAudit:          boolean
  daysSincePostponed: number
  needsNewDate:       boolean
  remindHost:         boolean
}

/** Pure: timeline, "no new date", and whether the host is due a reminder (the claim decides if one is sent). */
export function planPostponed(facts: PostponedFacts[], now: Date): PostponedRow[] {
  return facts.map(f => {
    const t    = postponedTimeline(f.audit, f.updatedAt)
    const days = Math.max(0, Math.floor((now.getTime() - t.postponedAt.getTime()) / DAY_MS))
    const needsNewDate = !t.dateChangedSince || f.date < f.cityToday
    // Someone has to be waiting on it: seats, requests or a queue. An empty
    // postponed event still shows on the dashboard, but pings no one.
    const remindHost = needsNewDate && days >= POSTPONED_REMIND_AFTER_DAYS && f.seats + f.pending + f.waitlist > 0
    return { ...f, postponedAt: t.postponedAt, fromAudit: t.fromAudit, daysSincePostponed: days, needsNewDate, remindHost }
  }).sort((a, b) => Number(b.needsNewDate) - Number(a.needsNewDate) || b.daysSincePostponed - a.daysSincePostponed || a.id.localeCompare(b.id))
}

export async function loadPostponedEvents(opts: { cityId?: string | null } = {}): Promise<PostponedFacts[]> {
  const events = await prisma.event.findMany({
    where:  { status: 'postponed', ...(opts.cityId ? { cityId: opts.cityId } : {}) },
    select: {
      id: true, title: true, emoji: true, date: true, cityId: true, hostId: true, updatedAt: true, currency: true,
      city: { select: { name: true } }, cohosts: { select: { userId: true } },
    },
  })
  if (events.length === 0) return []
  const ids = events.map(e => e.id)
  const [days, attendees, waitlist, payments, audit] = await Promise.all([
    citiesByToday(),
    prisma.eventAttendee.findMany({ where: { eventId: { in: ids }, status: { in: ['approved', 'pending'] } }, select: { eventId: true, userId: true, status: true } }),
    prisma.waitlistEntry.findMany({ where: { eventId: { in: ids } }, select: { eventId: true } }),
    prisma.payment.findMany({ where: { eventId: { in: ids }, status: { in: ['pending', 'paid'] } }, select: { eventId: true, status: true, amount: true } }),
    prisma.auditLog.findMany({ where: { targetType: 'event', targetId: { in: ids }, action: 'event.update' }, select: { targetId: true, createdAt: true, meta: true } }),
  ])
  const todayOf = new Map(days.flatMap(d => d.cityIds.map(id => [id, d.date] as const)))
  return events.map(e => {
    const staff = new Set([e.hostId, ...e.cohosts.map(c => c.userId)])
    const mine  = attendees.filter(a => a.eventId === e.id && !staff.has(a.userId))
    const pays  = payments.filter(p => p.eventId === e.id)
    const pendingPays = pays.filter(p => p.status === 'pending')
    return {
      id: e.id, title: e.title, emoji: e.emoji, date: e.date, cityId: e.cityId, city: e.city?.name ?? e.cityId,
      // A city missing from the grouping reads as "date not passed" — the audit trail still decides.
      cityToday: todayOf.get(e.cityId) ?? '0000-01-01',
      hostId: e.hostId,
      seats:   mine.filter(a => a.status === 'approved').length,
      pending: mine.filter(a => a.status === 'pending').length,
      waitlist: waitlist.filter(w => w.eventId === e.id).length,
      paymentsPending: pendingPays.length,
      paymentsPendingTotal: pendingPays.reduce((s, p) => s + p.amount, 0),
      paymentsPaid: pays.filter(p => p.status === 'paid').length,
      currency: e.currency,
      updatedAt: e.updatedAt,
      audit: audit.filter(a => a.targetId === e.id).map(a => ({ createdAt: a.createdAt, meta: a.meta })),
    }
  })
}
