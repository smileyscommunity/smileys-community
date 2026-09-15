import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'
import { eventStartsAt, eventEndsAt } from '@/lib/eventTime'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { Attendance, AttendeeStatus } from '@/lib/constants'
import { eventRunners, noShowExemptionReason } from '@/lib/noShowPolicy'
import { standingEnforcement, type StandingEnforcement } from '@/lib/standingRead'
import {
  ATTENDANCE_AUTO_RESOLVE_HOURS, STANDING_SWEEP_LOOKBACK_DAYS, STANDING_STARTS_AT, STANDING_ENFORCE_SETTING,
  RECOVERY_REQUIRES_CHECKIN, LIVE_CARD_STATUSES, OffenceKind, OffenceStatus, CardLevel, StandingCardStatus,
  eventTier, classifyRow, refilledLateCancels, offenceCounts, decideIssuance, isSuccessfulCommitment,
  recoveryOutcome, cardLapsed, standingLevel, countedCommitments, commitmentsNeeded, canDispute, windowStart,
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

/**
 * Events whose attendance is ready to settle: started on or after
 * STANDING_STARTS_AT, ended at least ATTENDANCE_AUTO_RESOLVE_HOURS ago, and
 * within the lookback. Every pass over them is idempotent, so reading the
 * same event on each run for two weeks costs a few indexed queries.
 */
export async function resolvedEvents(now: Date): Promise<SweepEvent[]> {
  const floor = new Date(Math.max(STANDING_STARTS_AT.getTime(), now.getTime() - (STANDING_SWEEP_LOOKBACK_DAYS + 2) * DAY))
  const events = await prisma.event.findMany({
    where:  { date: { gte: isoDay(floor), lte: isoDay(now) }, cancelledAt: null, status: { in: ['published', 'archived'] } },
    select: SWEEP_EVENT_SELECT,
  })
  return events.filter(e => {
    const tz    = e.city?.timezone ?? DEFAULT_TZ
    const start = eventStartsAt(e, tz).getTime()
    const end   = eventEndsAt(e, tz).getTime()
    return start >= STANDING_STARTS_AT.getTime()
      && end + ATTENDANCE_AUTO_RESOLVE_HOURS * HOUR <= now.getTime()
      && end >= now.getTime() - STANDING_SWEEP_LOOKBACK_DAYS * DAY
  })
}

/**
 * An RSVP nobody resolved is attended. Never manufacture a penalty from host
 * inaction; the stamp is how to see which hosts aren't checking in.
 */
export async function autoResolveAttendance(eventId: string, now: Date): Promise<number> {
  const { count } = await prisma.eventAttendee.updateMany({
    where: { eventId, status: AttendeeStatus.Approved, checkedIn: false, attendance: Attendance.Unknown },
    data:  { attendance: Attendance.Attended, attendanceAutoResolvedAt: now },
  })
  return count
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
      select: { id: true, occurredAt: true, counts: true, status: true, cardId: true },
    })
    // Offences from before enforcement was switched on never make a real card.
    const ledger: LedgerOffence[] = offences.filter(o =>
      !enforcement.enforced || !enforcement.since || o.occurredAt.getTime() >= enforcement.since.getTime())
    const disputePending = ledger.some(o => o.status === OffenceStatus.Disputed)

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
      const last = await tx.eventAttendee.findFirst({ where: { userId }, orderBy: { joinedAt: 'desc' }, select: { joinedAt: true } })
      if (cardLapsed(live, last?.joinedAt ?? null, now)) {
        await tx.standingCard.update({ where: { id: live.id }, data: { status: StandingCardStatus.Lapsed, resolvedAt: now, resolutionNote: 'No RSVP activity' } })
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
  let autoResolved = 0

  // One event's failure must not take the others, or the card pass, with it.
  for (const e of events) {
    try {
      // Resolve first: after it, the only no-shows left are the declared ones.
      autoResolved += await autoResolveAttendance(e.id, now)
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
  const notified = await notifyStandingCards(enforcement)
  return { now: now.toISOString(), enforced: enforcement.enforced, events: events.length, autoResolved, members: touched.size, ...totals, notified, errors }
}

// ── Interventions ───────────────────────────────────────────────────────────

export type DisputeOutcome = 'ok' | 'not_found' | 'not_allowed' | 'not_enforced'

/** A member's "I was there". Only while standing is switched on — before, members see nothing to dispute. */
export async function disputeOffence(offenceId: string, userId: string, note: string, now: Date = new Date()): Promise<DisputeOutcome> {
  if (!(await standingEnforcement()).enforced) return 'not_enforced'
  const o = await prisma.standingOffence.findUnique({ where: { id: offenceId }, select: { userId: true, kind: true, status: true, occurredAt: true, disputedAt: true } })
  if (!o || o.userId !== userId) return 'not_found'
  if (!canDispute(o, now)) return 'not_allowed'
  const { count } = await prisma.standingOffence.updateMany({
    where: { id: offenceId, userId, status: OffenceStatus.Open, disputedAt: null },
    data:  { status: OffenceStatus.Disputed, disputedAt: now, disputeNote: note.trim().slice(0, 1000) || null },
  })
  return count > 0 ? 'ok' : 'not_allowed'
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
