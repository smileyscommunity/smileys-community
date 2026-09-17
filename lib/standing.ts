import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { sendAttendanceCheckEmail, sendNoShowRecordedEmail } from '@/lib/email'
import { writeAudit } from '@/lib/audit'
import { eventStartsAt, eventEndsAt } from '@/lib/eventTime'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { Attendance, AttendeeStatus } from '@/lib/constants'
import { eventRunners, noShowExemptionReason } from '@/lib/noShowPolicy'
import { standingEnforcement, type StandingEnforcement } from '@/lib/standingRead'
import {
  STANDING_SWEEP_LOOKBACK_DAYS, DISPUTE_WINDOW_DAYS, STANDING_STARTS_AT, STANDING_ENFORCE_SETTING,
  RECOVERY_REQUIRES_CHECKIN, LIVE_CARD_STATUSES, OffenceKind, OffenceStatus, CardLevel, StandingCardStatus,
  eventTier, classifyRow, refilledLateCancels, offenceCounts, decideIssuance, isSuccessfulCommitment,
  recoveryOutcome, cardLapsed, disputeHolds, standingLevel, countedCommitments, commitmentsNeeded, canDispute, windowStart,
  attendanceReviewOpensAt, attendanceSettlesAt, checkInRan, unmarkedGuests, doorKey,
  type LedgerOffence,
} from '@/lib/standingPolicy'

export { standingEnforcement, standingLevelsFor, standingLevelFor } from '@/lib/standingRead'
export type { StandingEnforcement } from '@/lib/standingRead'

// ── Standing: everything that touches the database ──────────────────────────
//
// The rules are in lib/standingPolicy.ts (pure, tested on their own). This
// applies them: the enforcement switch, the hourly sweep (resolve attendance,
// record offences, issue / clear / lapse cards), the two human interventions
// (a moderator on a dispute, an admin on a red card), and the reads the RSVP
// paths and the member page need.

type Tx = Prisma.TransactionClient

const HOUR = 60 * 60 * 1000
const DAY  = 24 * HOUR
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

// ── The switch ──────────────────────────────────────────────────────────────

/**
 * Switch enforcement. Switching ON retires every live shadow card and starts
 * the count fresh: those cards were never shown to anyone, and one offence
 * from the silent period plus one after launch must not make a yellow for
 * rules the member was never told about. Switching OFF pauses the effects;
 * cards keep their state.
 */
export async function setStandingEnforced(on: boolean, actor: { id: string; name: string }, now: Date = new Date()): Promise<StandingEnforcement> {
  const current = await standingEnforcement()
  if (current.enforced === on) return current
  const retired = await prisma.$transaction(async tx => {
    await tx.appSetting.upsert({
      where:  { key: STANDING_ENFORCE_SETTING },
      create: { key: STANDING_ENFORCE_SETTING, value: String(on) },
      update: { value: String(on) },
    })
    if (!on) return 0
    const { count } = await tx.standingCard.updateMany({
      where: { shadow: true, status: { in: LIVE_CARD_STATUSES } },
      data:  { status: StandingCardStatus.Lapsed, resolvedAt: now, resolutionNote: 'Shadow period ended when enforcement was switched on' },
    })
    return count
  })
  await writeAudit(actor.id, actor.name, on ? 'standing_enforcement_on' : 'standing_enforcement_off',
    STANDING_ENFORCE_SETTING, 'setting', { on, retiredShadowCards: retired },
    on ? `Standing enforcement switched on (${retired} shadow card${retired === 1 ? '' : 's'} retired)` : 'Standing enforcement switched off')
  return standingEnforcement()
}

// ── The sweep: which events ─────────────────────────────────────────────────

const SWEEP_EVENT_SELECT = {
  id: true, title: true, date: true, time: true, endTime: true,
  limitedSpots: true, totalSpots: true, tierOverride: true, cancelCutoffHours: true,
  hostId: true, cityId: true,
  city:    { select: { timezone: true, createdAt: true } },
  cohosts: { select: { userId: true } },
  club:    { select: { memberships: { where: { role: 'host', status: 'approved' }, select: { userId: true } } } },
} satisfies Prisma.EventSelect

export type SweepEvent = Prisma.EventGetPayload<{ select: typeof SWEEP_EVENT_SELECT }>

async function standingEvents(now: Date): Promise<SweepEvent[]> {
  const floor = new Date(Math.max(STANDING_STARTS_AT.getTime(), now.getTime() - (STANDING_SWEEP_LOOKBACK_DAYS + 2) * DAY))
  const events = await prisma.event.findMany({
    where:  { date: { gte: isoDay(floor), lte: isoDay(now) }, cancelledAt: null, status: { in: ['published', 'archived'] } },
    select: SWEEP_EVENT_SELECT,
  })
  return events.filter(e => {
    const tz = e.city?.timezone ?? DEFAULT_TZ
    return eventStartsAt(e, tz).getTime() >= STANDING_STARTS_AT.getTime()
      && eventEndsAt(e, tz).getTime() >= now.getTime() - STANDING_SWEEP_LOOKBACK_DAYS * DAY
  })
}

const tzOf = (e: SweepEvent) => e.city?.timezone ?? DEFAULT_TZ

/**
 * Events whose attendance is ready to settle: started on or after
 * STANDING_STARTS_AT, past the end of the host's review day
 * (attendanceSettlesAt), and within the lookback. Every pass over them is
 * idempotent, so reading the same event on each run for two weeks costs a few
 * indexed queries.
 */
export async function resolvedEvents(now: Date): Promise<SweepEvent[]> {
  return (await standingEvents(now)).filter(e => attendanceSettlesAt(e, tzOf(e)).getTime() <= now.getTime())
}

/** Events in their host's review day: the list has gone (or is due), the room hasn't settled. */
export async function reviewingEvents(now: Date): Promise<SweepEvent[]> {
  return (await standingEvents(now)).filter(e => {
    const tz = tzOf(e)
    return attendanceReviewOpensAt(e, tz).getTime() <= now.getTime() && now.getTime() < attendanceSettlesAt(e, tz).getTime()
  })
}

async function roomOf(event: SweepEvent) {
  const runners = eventRunners(event)
  const rows = await prisma.eventAttendee.findMany({
    where:   { eventId: event.id, status: AttendeeStatus.Approved },
    orderBy: { joinedAt: 'asc' },
    select:  { id: true, userId: true, checkedIn: true, attendance: true, user: { select: { name: true, email: true, role: true } } },
  })
  return rows.map(r => ({ ...r, exempt: noShowExemptionReason(r.userId, r.user?.role, runners) !== null }))
}

/**
 * Settle what the host left unmarked. Where they ran check-in (checkInRan),
 * an unmarked guest is a no-show: they had the morning-after list and a whole
 * day to check them in or excuse them. Where nobody ran the door, nobody is
 * penalised for it and the room counts as attended. The stamp tells a
 * defaulted row from one a person marked.
 */
export async function settleAttendance(event: SweepEvent, now: Date): Promise<{ attended: number; absent: number }> {
  const room = await roomOf(event)
  // Only once, and only if the list reached someone. The sweep reads the event
  // for two weeks: a guest added after it settled (an admin restoring a row)
  // was never on anyone's list, and neither was a room whose review never
  // went out (the ratio crossed half only late in the day, a sweep outage).
  // Both settle as attended — the safe side.
  const first    = await claimOnce(`attendance-settled:${event.id}`, 30 * DAY)
  const reviewed = first && await hasClaim(reviewSentKey(event.id), now)
  const absentee = new Set(reviewed && checkInRan(room) ? unmarkedGuests(room).map(r => r.id) : [])
  const unmarked = room.filter(r => !r.checkedIn && r.attendance === Attendance.Unknown)
  const still    = { status: AttendeeStatus.Approved, checkedIn: false, attendance: Attendance.Unknown }
  const [absent, attended] = await Promise.all([
    absentee.size === 0 ? { count: 0 } : prisma.eventAttendee.updateMany({
      where: { id: { in: [...absentee] }, ...still },
      data:  { attendance: Attendance.NoShow, attendanceAutoResolvedAt: now },
    }),
    prisma.eventAttendee.updateMany({
      where: { id: { in: unmarked.filter(r => !absentee.has(r.id)).map(r => r.id) }, ...still },
      data:  { attendance: Attendance.Attended, attendanceAutoResolvedAt: now },
    }),
  ])
  return { attended: attended.count, absent: absent.count }
}

const reviewSentKey = (eventId: string) => `attendance-review-sent:${eventId}`
// A guest said "I was there" during the review (POST /api/events/[id]/attendance-claim).
export const saysCameKey = (eventId: string, userId: string) => `attendance-says-came:${eventId}:${userId}`
// Resend allows 10 sends a second; the sweeps that ignored it got 429s.
const pause = () => new Promise(r => setTimeout(r, 150))

async function hasClaim(key: string, now: Date): Promise<boolean> {
  const row = await prisma.rateLimit.findUnique({ where: { key }, select: { resetAt: true } })
  return !!row && row.resetAt.getTime() > now.getTime()
}

const names = (list: { user: { name: string } | null }[]) => {
  const shown = list.slice(0, 4).map(r => r.user?.name ?? 'a guest')
  const more  = list.length - shown.length
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.length > 1
    ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0]
}

/**
 * The morning-after list, once per event and person, to everyone who runs the
 * door (host, co-hosts, the club's hosts, and any admin who checked people in): who wasn't checked in, and that the
 * rest of the day is theirs to fix it. Only where check-in ran — anywhere else
 * nothing will count, so there is nothing to review. A room settles to no-show
 * only after this reached someone (settleAttendance), so it goes out whether
 * or not enforcement is on.
 */
export async function sendAttendanceReviews(event: SweepEvent): Promise<number> {
  const room = await roomOf(event)
  if (!checkInRan(room)) return 0
  const missing = unmarkedGuests(room)
  if (missing.length === 0) return 0
  const e = await prisma.event.findUnique({ where: { id: event.id }, select: { emoji: true } })
  const runners = eventRunners(event)
  // And whoever else checked people in — an admin running the door.
  const prefix  = doorKey(event.id, '')
  const door    = (await prisma.rateLimit.findMany({ where: { key: { startsWith: prefix } }, select: { key: true } }))
    .map(r => r.key.slice(prefix.length))
  const recipients = [...new Set([runners.hostId, ...runners.cohostIds, ...runners.clubHostIds, ...door].filter((u): u is string => !!u))]
  const n  = missing.length
  const tz = tzOf(event)
  // Where a no-show only gets noted (an open event, a city in its first 90
  // days) the list still goes — the record is the point — but it must not
  // threaten what won't happen.
  const { counts, loggedReason } = offenceCounts(eventTier(event), event.city?.createdAt ?? null, eventStartsAt(event, tz))
  const consequence = counts
    ? `After that ${n === 1 ? 'it counts' : 'each counts'} as a no-show.`
    : `After that ${n === 1 ? 'it goes' : 'each goes'} on the record as a no-show, though ${loggedReason === 'new_city' ? 'nothing counts against anyone in a new city yet' : "it doesn't count on an open event"}.`
  let sent = 0
  for (const userId of recipients) {
    const key = `attendance-review:${event.id}:${userId}`
    if (!await claimOnce(key, 7 * DAY)) continue
    const ok = await createNotification(userId, 'attendance_review',
      `${e?.emoji ?? '📋'} ${n} not checked in at ${event.title}`,
      `${names(missing)}. Check in anyone who came, or excuse them, by midnight tonight. ${consequence}`,
      `/host/checkin?event=${event.id}`)
    if (ok) sent++
    else await releaseClaim(key)
  }
  if (sent > 0) await claimOnce(reviewSentKey(event.id), 30 * DAY)
  else if (!await hasClaim(reviewSentKey(event.id), new Date())) return 0

  // And each guest on the list, the same morning: someone who was there can
  // tell the host while one tap still fixes it, instead of finding out from a
  // no-show and waiting on a moderator. Only once the host's list has gone,
  // so a guest is never told the host can fix what the host wasn't told about.
  // Only where the no-show would count: elsewhere it is only noted, and "it
  // counts on your standing" would be untrue.
  if (!counts) return sent
  for (const g of missing) {
    const key = `attendance-review-guest:${event.id}:${g.userId}`
    if (!await claimOnce(key, 7 * DAY)) continue
    const ok = await createNotification(g.userId, 'attendance_check',
      `${e?.emoji ?? '🎟️'} You weren't checked in at ${event.title}`,
      'If you were there, tap "I was there" on the event page today — the host can still check you in. After midnight it counts as a no-show on your standing.',
      `/events/${event.id}`)
    if (!ok) { await releaseClaim(key); continue }
    // Most members have no push: the email is what actually reaches them.
    if (g.user?.email) {
      await sendAttendanceCheckEmail(g.user.email, g.user.name, event.title, e?.emoji ?? '🎟️', event.id)
        .catch(err => console.error('[standing] attendance check email failed', { eventId: event.id, err: String(err) }))
      await pause()
    }
  }
  return sent
}

/**
 * Record this event's offences, once per RSVP row. A late cancel whose seat
 * someone then used is recorded as forgiven — kept, so the rate of real harm
 * can be read, but never counted. Returns the members recorded.
 */
export async function recordOffences(event: SweepEvent): Promise<Set<string>> {
  const tz       = event.city?.timezone ?? DEFAULT_TZ
  const startsAt = eventStartsAt(event, tz)
  const runners  = eventRunners(event)
  const rows = await prisma.eventAttendee.findMany({
    where:  { eventId: event.id, OR: [{ status: AttendeeStatus.Approved }, { status: AttendeeStatus.Cancelled, cancelledBy: 'member' }] },
    select: {
      id: true, userId: true, status: true, checkedIn: true, attendance: true, joinedAt: true,
      cancelledAt: true, cancelledBy: true, cancelledLate: true, reconfirmAskedAt: true, user: { select: { role: true } },
    },
  })
  const classified = rows.flatMap(r => {
    const kind = classifyRow(r, startsAt, event, runners)
    return kind ? [{ row: r, kind }] : []
  })
  if (classified.length === 0) return new Set()

  const lateCancels = classified.filter(c => c.kind === OffenceKind.LateCancel).map(c => ({ id: c.row.id, cancelledAt: c.row.cancelledAt! }))
  const arrivals    = rows.filter(r => r.status === AttendeeStatus.Approved && !noShowExemptionReason(r.userId, r.user?.role, runners))
  const forgiven    = refilledLateCancels(lateCancels, arrivals)
  const tier        = eventTier(event)
  const { counts, loggedReason } = offenceCounts(tier, event.city?.createdAt ?? null, startsAt)

  await prisma.standingOffence.createMany({
    data: classified.map(({ row, kind }) => ({
      userId: row.userId, attendeeId: row.id, eventId: event.id, kind, tier, counts, loggedReason, occurredAt: startsAt,
      ...(forgiven.has(row.id) ? { status: OffenceStatus.Forgiven, resolutionNote: 'Seat refilled from the waitlist by someone who came' } : {}),
    })),
    skipDuplicates: true,
  })
  return new Set(classified.filter(c => !forgiven.has(c.row.id)).map(c => c.row.userId))
}

// ── Cards ───────────────────────────────────────────────────────────────────

/**
 * One member at a time, whichever path gets there first (sweep, moderator, admin).
 * Wrapped to return a column, as lib/rsvpConfirmed does: pg_advisory_xact_lock
 * returns void, which the Prisma pg adapter can't deserialize — a bare SELECT of
 * it threw on every evaluation, and no card could ever be issued.
 */
async function lockMember(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`standing:${userId}`}))) AS l`
}

type LiveCardRow = { id: string; level: string; status: string; triggeredAt: Date; issuedAt: Date; shadow: boolean }

export interface EvaluateResult {
  issued:  { id: string; level: string; shadow: boolean }[]
  cleared: { id: string; shadow: boolean }[]
  review:  { id: string; shadow: boolean }[]
  lapsed:  string[]
}

/**
 * Bring one member's card up to date: issue or escalate from the ledger, award
 * the commitments earned since the card, clear it or send it for review, and
 * lapse it after a quiet period. Idempotent — safe to run on every sweep.
 */
export async function evaluateMember(userId: string, now: Date): Promise<EvaluateResult> {
  const result: EvaluateResult = { issued: [], cleared: [], review: [], lapsed: [] }
  await prisma.$transaction(async tx => {
    await lockMember(tx, userId)
    // The switch is read under the lock: a sweep that began before an admin
    // flipped it must not issue a card for the wrong side of it.
    const enforcement = await standingEnforcement(tx)

    const offences = await tx.standingOffence.findMany({
      where:  { userId, status: { in: [OffenceStatus.Open, OffenceStatus.Disputed] } },
      select: { id: true, occurredAt: true, counts: true, status: true, cardId: true, disputedAt: true },
    })
    // Offences from before enforcement was switched on never make a real card.
    const ledger: LedgerOffence[] = offences.filter(o =>
      !enforcement.enforced || !enforcement.since || o.occurredAt.getTime() >= enforcement.since.getTime())
    const disputePending = disputeHolds(offences.filter(o => ledger.includes(o)), now)

    const liveCards = await tx.standingCard.findMany({
      // Each side of the switch works on its own cards only: while it is off a
      // real card is paused, never escalated into a shadow one.
      where:   { userId, status: { in: LIVE_CARD_STATUSES }, shadow: !enforcement.enforced },
      orderBy: { issuedAt: 'desc' },
      select:  { id: true, level: true, status: true, triggeredAt: true, issuedAt: true, shadow: true },
    })
    let live: LiveCardRow | null = liveCards[0] ?? null

    for (let step = 0; step < 3; step++) {
      const d = decideIssuance(ledger, live, now, disputePending)
      if (d.kind === 'none') break
      if (d.kind === 'attach') {
        await tx.standingOffence.updateMany({ where: { id: { in: d.offenceIds } }, data: { cardId: d.cardId } })
        for (const o of ledger) if (d.offenceIds.includes(o.id)) o.cardId = d.cardId
        break
      }
      const shadow: boolean = !enforcement.enforced
      if (d.kind === 'escalate') {
        await tx.standingCard.update({
          where: { id: d.fromCardId },
          data:  { status: StandingCardStatus.Escalated, resolvedAt: now, resolutionNote: 'Escalated to red' },
        })
      }
      const card: LiveCardRow = await tx.standingCard.create({
        data: {
          userId, shadow, triggeredAt: d.triggeredAt,
          level:      d.kind === 'yellow' ? CardLevel.Yellow : CardLevel.Red,
          fromCardId: d.kind === 'escalate' ? d.fromCardId : null,
        },
        select: { id: true, level: true, status: true, triggeredAt: true, issuedAt: true, shadow: true },
      })
      await tx.standingOffence.updateMany({ where: { id: { in: d.offenceIds } }, data: { cardId: card.id } })
      for (const o of ledger) if (d.offenceIds.includes(o.id)) o.cardId = card.id
      result.issued.push({ id: card.id, level: card.level, shadow: card.shadow })
      live = card
    }

    if (live && live.status === StandingCardStatus.Active) {
      const card = live
      const rows = await tx.eventAttendee.findMany({
        where: {
          userId, status: AttendeeStatus.Approved,
          ...(RECOVERY_REQUIRES_CHECKIN ? { checkedIn: true } : {}),
          event: { cancelledAt: null, date: { gte: isoDay(new Date(card.triggeredAt.getTime() - DAY)) } },
        },
        select: {
          id: true, status: true, checkedIn: true, attendance: true,
          event: { select: { date: true, time: true, endTime: true, city: { select: { timezone: true } } } },
        },
      })
      const earned = rows.filter(r => {
        const tz = r.event.city?.timezone ?? DEFAULT_TZ
        return isSuccessfulCommitment(r, eventStartsAt(r.event, tz), eventEndsAt(r.event, tz), card, now)
      })
      if (earned.length > 0) {
        await tx.standingRecovery.createMany({
          data: earned.map(r => ({ cardId: card.id, attendeeId: r.id, source: 'attendance' })),
          skipDuplicates: true,
        })
      }
      const recoveries = await tx.standingRecovery.findMany({ where: { cardId: card.id }, select: { source: true } })
      const tally = {
        attendance:    recoveries.filter(r => r.source === 'attendance').length,
        contributions: recoveries.filter(r => r.source !== 'attendance').length,
      }
      const outcome = recoveryOutcome(card, tally)
      if (outcome === 'cleared') {
        await tx.standingCard.update({ where: { id: card.id }, data: { status: StandingCardStatus.Cleared, resolvedAt: now, resolutionNote: 'Successful commitments' } })
        result.cleared.push({ id: card.id, shadow: card.shadow })
        live = null
      } else if (outcome === 'review') {
        await tx.standingCard.update({ where: { id: card.id }, data: { status: StandingCardStatus.Review, resolutionNote: 'Commitments done — waiting on an admin' } })
        result.review.push({ id: card.id, shadow: card.shadow })
        live = { ...card, status: StandingCardStatus.Review }
      }
    }

    if (live && live.status === StandingCardStatus.Active) {
      const lastOffence = ledger.filter(o => o.counts).reduce<Date | null>((m, o) => !m || o.occurredAt > m ? o.occurredAt : m, null)
      if (cardLapsed(live, lastOffence, now)) {
        await tx.standingCard.update({ where: { id: live.id }, data: { status: StandingCardStatus.Lapsed, resolvedAt: now, resolutionNote: 'No new missed commitment' } })
        result.lapsed.push(live.id)
      }
    }
  })
  return result
}

/**
 * Take a card down because an offence under it was overturned, detaching its
 * other offences so they can count again. A yellow that had escalated takes
 * its red down with it; a red that falls hands its member back the yellow it
 * escalated from.
 */
async function withdrawCard(tx: Tx, cardId: string, byId: string | null, note: string, now: Date) {
  const card = await tx.standingCard.findUnique({ where: { id: cardId }, select: { id: true, level: true, status: true, fromCardId: true } })
  if (!card) return
  const retire = async (id: string) => {
    await tx.standingCard.update({ where: { id }, data: { status: StandingCardStatus.Withdrawn, resolvedAt: now, resolvedById: byId, resolutionNote: note } })
    await tx.standingOffence.updateMany({ where: { cardId: id, status: { in: [OffenceStatus.Open, OffenceStatus.Disputed] } }, data: { cardId: null } })
  }
  if (card.status === StandingCardStatus.Escalated) {
    const reds = await tx.standingCard.findMany({ where: { fromCardId: card.id, status: { in: LIVE_CARD_STATUSES } }, select: { id: true } })
    for (const r of reds) await retire(r.id)
    await retire(card.id)
    return
  }
  if (!LIVE_CARD_STATUSES.includes(card.status)) return
  await retire(card.id)
  if (card.level === CardLevel.Red && card.fromCardId) {
    await tx.standingCard.updateMany({
      where: { id: card.fromCardId, status: StandingCardStatus.Escalated },
      data:  { status: StandingCardStatus.Active, resolvedAt: null, resolutionNote: null },
    })
  }
}

/**
 * Overturn an offence: they came. The attendee row follows (a declared no-show
 * becomes attended) and any card the offence stood under is withdrawn.
 * Returns the member, or null when there was nothing open to overturn. The
 * caller re-evaluates the member.
 */
export async function overturnOffence(offenceId: string, opts: { byId: string | null; note: string; now: Date }): Promise<string | null> {
  return prisma.$transaction(async tx => {
    const o = await tx.standingOffence.findUnique({ where: { id: offenceId }, select: { id: true, userId: true, attendeeId: true, kind: true, status: true, cardId: true } })
    if (!o) return null
    await lockMember(tx, o.userId)
    const { count } = await tx.standingOffence.updateMany({
      where: { id: o.id, status: { in: [OffenceStatus.Open, OffenceStatus.Disputed] } },
      data:  { status: OffenceStatus.Overturned, resolvedAt: opts.now, resolvedById: opts.byId, resolutionNote: opts.note },
    })
    if (count === 0) return null
    if (o.kind === OffenceKind.NoShow) {
      await tx.eventAttendee.updateMany({ where: { id: o.attendeeId, attendance: Attendance.NoShow }, data: { attendance: Attendance.Attended } })
    }
    if (o.cardId) await withdrawCard(tx, o.cardId, opts.byId, opts.note, opts.now)
    return o.userId
  })
}

/** Offences whose row was checked in after they were recorded: the scan settles it. */
export async function overturnCorrected(eventIds: string[], now: Date): Promise<Set<string>> {
  const users = new Set<string>()
  if (eventIds.length === 0) return users
  const stale = await prisma.standingOffence.findMany({
    where:  { eventId: { in: eventIds }, status: { in: [OffenceStatus.Open, OffenceStatus.Disputed] }, attendee: { checkedIn: true } },
    select: { id: true },
  })
  for (const s of stale) {
    const userId = await overturnOffence(s.id, { byId: null, note: 'Checked in after the offence was recorded', now })
    if (userId) users.add(userId)
  }
  return users
}

// ── Notifications (enforcement only) ────────────────────────────────────────

/**
 * Tell a member about a no-show that counts, once: whether the host marked
 * it or it was left unmarked after the review, with the way to say they came.
 */
export async function notifyNoShows(eventIds: string[], enforcement: StandingEnforcement): Promise<number> {
  if (!enforcement.enforced || eventIds.length === 0) return 0
  const offences = await prisma.standingOffence.findMany({
    where:  {
      eventId: { in: eventIds }, kind: OffenceKind.NoShow, counts: true, status: OffenceStatus.Open,
      ...(enforcement.since ? { occurredAt: { gte: enforcement.since } } : {}),
    },
    select: {
      id: true, userId: true, event: { select: { title: true, emoji: true } },
      attendee: { select: { attendanceAutoResolvedAt: true } }, user: { select: { name: true, email: true } },
    },
  })
  let sent = 0
  for (const o of offences) {
    const key = `standing-no-show:${o.id}`
    if (!await claimOnce(key, 120 * DAY)) continue
    const how = o.attendee?.attendanceAutoResolvedAt ? "You weren't checked in" : 'The host marked you absent'
    const ok = await createNotification(o.userId, 'standing_no_show', `${o.event.emoji} Missed: ${o.event.title}`,
      `${how}, so it counts as a no-show on your standing. Were you there? Tap "I was there" within ${DISPUTE_WINDOW_DAYS} days.`,
      '/standing')
    if (!ok) { await releaseClaim(key); continue }
    sent++
    if (o.user?.email) {
      await sendNoShowRecordedEmail(o.user.email, o.user.name, o.event.title, o.event.emoji, !!o.attendee?.attendanceAutoResolvedAt)
        .catch(err => console.error('[standing] no-show email failed', { offenceId: o.id, err: String(err) }))
      await pause()
    }
  }
  return sent
}

/** Tell members about real cards issued since the last run. Stamped after the send. */
export async function notifyStandingCards(enforcement: StandingEnforcement): Promise<number> {
  if (!enforcement.enforced) return 0
  const cards = await prisma.standingCard.findMany({
    where:   { shadow: false, notifiedAt: null, status: { in: LIVE_CARD_STATUSES } },
    orderBy: { issuedAt: 'asc' },
    take:    200,
    select:  { id: true, userId: true, level: true },
  })
  let sent = 0
  for (const c of cards) {
    const ok = c.level === CardLevel.Red
      ? await createNotification(c.userId, 'standing_red', '🟥 Red card',
          "Another missed commitment on a small event while on a yellow card. Seats at small events now need the host's approval — open events are unaffected. Three successful commitments make you eligible for review.",
          '/standing')
      : await createNotification(c.userId, 'standing_yellow', '🟨 Yellow card',
          'Two missed commitments on small events in 90 days. Two successful commitments clear it — being checked in at any event counts.',
          '/standing')
    if (ok) {
      await prisma.standingCard.update({ where: { id: c.id }, data: { notifiedAt: new Date() } })
      sent++
    }
  }
  return sent
}

// ── The hourly job ──────────────────────────────────────────────────────────

export async function sweepStanding(now: Date = new Date()) {
  const enforcement = await standingEnforcement()
  const events = await resolvedEvents(now)
  const touched = new Set<string>()
  const errors: string[] = []
  let autoResolved = 0, defaultedAbsent = 0, reviewsSent = 0

  for (const e of await reviewingEvents(now)) {
    try {
      reviewsSent += await sendAttendanceReviews(e)
    } catch (err) {
      console.error('[standing] review notice failed', { eventId: e.id, err: String(err) })
      errors.push(`review:${e.id}`)
    }
  }

  // One event's failure must not take the others, or the card pass, with it.
  for (const e of events) {
    try {
      // Settle first: after it, every no-show is on the row for recordOffences.
      const settled = await settleAttendance(e, now)
      autoResolved    += settled.attended
      defaultedAbsent += settled.absent
      for (const userId of await recordOffences(e)) touched.add(userId)
    } catch (err) {
      console.error('[standing] event pass failed', { eventId: e.id, err: String(err) })
      errors.push(e.id)
    }
  }
  for (const userId of await overturnCorrected(events.map(e => e.id), now)) touched.add(userId)
  // Every member with a live card, for recovery and lapse.
  const live = await prisma.standingCard.findMany({ where: { status: StandingCardStatus.Active }, distinct: ['userId'], select: { userId: true } })
  for (const c of live) touched.add(c.userId)

  const totals = { yellow: 0, red: 0, cleared: 0, review: 0, lapsed: 0 }
  for (const userId of touched) {
    try {
      const r = await evaluateMember(userId, now)
      totals.yellow  += r.issued.filter(c => c.level === CardLevel.Yellow).length
      totals.red     += r.issued.filter(c => c.level === CardLevel.Red).length
      totals.cleared += r.cleared.length
      totals.review  += r.review.length
      totals.lapsed  += r.lapsed.length
      if (enforcement.enforced) {
        if (r.cleared.some(c => !c.shadow)) {
          await createNotification(userId, 'standing_cleared', '✅ Card cleared',
            'Two successful commitments — your yellow card is cleared. Thanks for showing up.', '/standing')
        }
        if (r.review.some(c => !c.shadow)) {
          await createNotification(userId, 'standing_review', 'Commitments done',
            'Three successful commitments since your red card. An admin will review it and restore your standing.', '/standing')
        }
      }
    } catch (err) {
      console.error('[standing] evaluate failed', { userId, err: String(err) })
      errors.push(`user:${userId}`)
    }
  }
  const noShowsNotified = await notifyNoShows(events.map(e => e.id), enforcement)
  const notified = await notifyStandingCards(enforcement)
  return {
    now: now.toISOString(), enforced: enforcement.enforced, events: events.length, reviewsSent,
    autoResolved, defaultedAbsent, members: touched.size, ...totals, noShowsNotified, notified, errors,
  }
}

// ── Interventions ───────────────────────────────────────────────────────────

export type DisputeOutcome = 'ok' | 'not_found' | 'not_allowed' | 'not_enforced'

/** A member's "I was there". Only while standing is switched on — before, members see nothing to dispute. */
export async function disputeOffence(offenceId: string, userId: string, note: string, now: Date = new Date()): Promise<DisputeOutcome> {
  if (!(await standingEnforcement()).enforced) return 'not_enforced'
  const o = await prisma.standingOffence.findUnique({
    where:  { id: offenceId },
    select: { userId: true, kind: true, status: true, occurredAt: true, disputedAt: true, event: { select: { title: true, cityId: true } } },
  })
  if (!o || o.userId !== userId) return 'not_found'
  if (!canDispute(o, now)) return 'not_allowed'
  const { count } = await prisma.standingOffence.updateMany({
    where: { id: offenceId, userId, status: OffenceStatus.Open, disputedAt: null },
    data:  { status: OffenceStatus.Disputed, disputedAt: now, disputeNote: note.trim().slice(0, 1000) || null },
  })
  if (count === 0) return 'not_allowed'
  // The inbox ping: admins, and the moderators of the event's city. Without it
  // a dispute only sat on /admin/standing, holding that member's cards for as
  // long as nobody happened to look (DISPUTE_HOLD_DAYS bounds that now).
  const staff = await prisma.user.findMany({
    where:  { status: 'approved', OR: [{ role: 'admin' }, { role: 'moderator', cityId: o.event.cityId }] },
    select: { id: true },
  })
  for (const s of staff) {
    await createNotification(s.id, 'standing_dispute', '⚖️ "I was there" to review',
      `A member disputes a no-show at "${o.event.title}". Decide it on the standing page.`, '/admin/standing')
  }
  return 'ok'
}

export type ResolveOutcome = 'ok' | 'not_found' | 'not_disputed'

/** A moderator's decision on a dispute: overturn (they came) or uphold. */
export async function resolveDispute(opts: {
  offenceId: string; resolver: { id: string; name: string }; decision: 'overturn' | 'uphold'; note: string; now?: Date
}): Promise<ResolveOutcome> {
  const now = opts.now ?? new Date()
  const o = await prisma.standingOffence.findUnique({
    where:  { id: opts.offenceId },
    select: { id: true, userId: true, status: true, eventId: true, event: { select: { title: true } } },
  })
  if (!o) return 'not_found'
  if (o.status !== OffenceStatus.Disputed) return 'not_disputed'
  const note = opts.note.trim().slice(0, 1000)

  if (opts.decision === 'overturn') {
    if (!await overturnOffence(o.id, { byId: opts.resolver.id, note: note || 'Dispute accepted', now })) return 'not_disputed'
  } else {
    const { count } = await prisma.standingOffence.updateMany({
      where: { id: o.id, status: OffenceStatus.Disputed },
      data:  { status: OffenceStatus.Open, resolvedAt: now, resolvedById: opts.resolver.id, resolutionNote: note || 'Dispute not accepted' },
    })
    if (count === 0) return 'not_disputed'
  }

  await writeAudit(opts.resolver.id, opts.resolver.name,
    opts.decision === 'overturn' ? 'standing_dispute_accepted' : 'standing_dispute_rejected',
    o.userId, 'user', { offenceId: o.id, eventId: o.eventId, note })

  const enforcement = await standingEnforcement()
  await evaluateMember(o.userId, now)
  if (enforcement.enforced) {
    if (opts.decision === 'overturn') {
      await createNotification(o.userId, 'standing_dispute_resolved', '✅ Dispute accepted',
        `Your "I was there" for "${o.event.title}" was accepted — the no-show is off your record.`, '/standing')
    } else {
      await createNotification(o.userId, 'standing_dispute_resolved', 'Dispute reviewed',
        `A moderator reviewed your "I was there" for "${o.event.title}", and the no-show stands.`, '/standing')
    }
    await notifyStandingCards(enforcement)
  }
  return 'ok'
}

export type RestoreOutcome = 'ok' | 'not_found' | 'not_live'

/** An admin's review of a red card. The review is the clearance: it stays a human decision. */
export async function restoreRedCard(opts: { cardId: string; admin: { id: string; name: string }; note: string; now?: Date }): Promise<RestoreOutcome> {
  const now  = opts.now ?? new Date()
  const card = await prisma.standingCard.findUnique({ where: { id: opts.cardId }, select: { id: true, userId: true, level: true, status: true, shadow: true } })
  if (!card || card.level !== CardLevel.Red) return 'not_found'
  // Under the member's lock, so a sweep evaluating them can't write over the review.
  const count = await prisma.$transaction(async tx => {
    await lockMember(tx, card.userId)
    const r = await tx.standingCard.updateMany({
      where: { id: card.id, status: { in: LIVE_CARD_STATUSES } },
      data:  { status: StandingCardStatus.Restored, resolvedAt: now, resolvedById: opts.admin.id, resolutionNote: opts.note.trim().slice(0, 1000) || 'Restored on review' },
    })
    return r.count
  })
  if (count === 0) return 'not_live'
  await writeAudit(opts.admin.id, opts.admin.name, 'standing_red_restored', card.userId, 'user', { cardId: card.id, note: opts.note })
  if (!card.shadow && (await standingEnforcement()).enforced) {
    await createNotification(card.userId, 'standing_restored', '✅ Standing restored',
      'An admin reviewed your red card and restored your standing. Thanks for showing up.', '/standing')
  }
  return 'ok'
}

// ── Member-facing summary ───────────────────────────────────────────────────

/** What /standing shows: nothing at all until standing is switched on. */
export async function memberStanding(userId: string, now: Date = new Date()) {
  const enforcement = await standingEnforcement()
  if (!enforcement.enforced) return { enforced: false as const, level: 'good' as const, card: null, offences: [] }

  const floor = new Date(Math.max(windowStart(now).getTime(), enforcement.since?.getTime() ?? 0))
  const [cards, offences] = await Promise.all([
    prisma.standingCard.findMany({
      where:   { userId, shadow: false, status: { in: LIVE_CARD_STATUSES } },
      orderBy: { issuedAt: 'desc' },
      select:  {
        id: true, level: true, status: true, shadow: true, issuedAt: true,
        recoveries: {
          orderBy: { awardedAt: 'asc' },
          select:  { source: true, awardedAt: true, attendee: { select: { event: { select: { id: true, title: true, emoji: true, date: true } } } } },
        },
      },
    }),
    prisma.standingOffence.findMany({
      where:   { userId, occurredAt: { gte: floor } },
      orderBy: { occurredAt: 'desc' },
      select:  {
        id: true, kind: true, tier: true, counts: true, loggedReason: true, status: true, occurredAt: true,
        disputedAt: true, disputeNote: true, resolutionNote: true, event: { select: { id: true, title: true, emoji: true, date: true } },
      },
    }),
  ])
  const card  = cards[0] ?? null
  const tally = card
    ? { attendance: card.recoveries.filter(r => r.source === 'attendance').length, contributions: card.recoveries.filter(r => r.source !== 'attendance').length }
    : null
  return {
    enforced: true as const,
    level:    standingLevel(cards, true),
    card: card && tally ? {
      id: card.id, level: card.level, status: card.status, issuedAt: card.issuedAt,
      have: countedCommitments(card.level, tally), need: commitmentsNeeded(card.level),
      recoveries: card.recoveries.map(r => ({ source: r.source, awardedAt: r.awardedAt, event: r.attendee?.event ?? null })),
    } : null,
    offences: offences.map(({ event, ...o }) => ({ ...o, event, canDispute: canDispute(o, now) })),
  }
}
