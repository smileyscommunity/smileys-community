import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendYellowCardEmail, sendRedCardEmail, recordEmailFailure } from '@/lib/email'
import { writeAudit } from '@/lib/audit'
import { eventStartsAt, eventEndsAt } from '@/lib/eventTime'
import { todayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { Attendance } from '@/lib/constants'
import {
  CardKind, CardStatus, COUNTING_STATUSES,
  NO_SHOW_PROCESSING_DELAY_HOURS, NO_SHOW_PROCESSING_LOOKBACK_DAYS,
  isFreeEvent, isNoShow, checkInIsCredible, windowStart, cardKindFor, redCardWindows, restrictionAfterRejectedAppeal,
  evaluateGate, type GateResult,
} from '@/lib/noShowPolicy'

// ── No-show cards: everything that touches the database ─────────────────────
//
// The rules are in lib/noShowPolicy.ts (pure, tested on their own). This file
// applies them: the RSVP gate the join paths call, the hourly settlement the
// cron runs, and the three human interventions — a member's appeal, a host's
// waiver, an admin's resolution.

const HOUR = 60 * 60 * 1000
const DAY  = 24 * HOUR

const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: DEFAULT_TZ })

// ── The gate ────────────────────────────────────────────────────────────────

const gateSelect = {
  id: true, kind: true, status: true, eventId: true, occurredAt: true, acknowledgedAt: true,
  appealDeadlineAt: true, restrictionStartsAt: true, restrictionEndsAt: true,
} as const

/** May this member RSVP or join a waitlist right now? */
export async function getRsvpGate(userId: string, now: Date = new Date()): Promise<GateResult> {
  const cards = await prisma.noShowCard.findMany({
    where:  { userId, status: CardStatus.Active },
    select: gateSelect,
  })
  return evaluateGate(cards, now)
}

export type RsvpCheck = GateResult | { ok: true; pendingAck: true }

/**
 * The join routes' entry point: the gate, plus the yellow-card confirmation.
 * A member whose only obstacle is an unacknowledged yellow card passes when
 * the request carries the confirmation; the route then records it with
 * recordYellowAcknowledgement once the join has actually succeeded — a
 * flag on a request that bounced (full, already joined, quota) must not
 * silence the prompt. A block is reported first, whatever the flag says.
 */
export async function checkRsvpAllowed(
  userId: string,
  opts: { eventId: string; acknowledge: boolean },
  now: Date = new Date(),
): Promise<RsvpCheck> {
  const gate = await getRsvpGate(userId, now)
  if (gate.ok || gate.code !== 'yellow_ack_required' || !opts.acknowledge) return gate
  return { ok: true, pendingAck: true }
}

/** "I'll actually come", kept: every outstanding yellow at once — one promise. */
export async function recordYellowAcknowledgement(userId: string, eventId: string, now: Date = new Date()): Promise<void> {
  await prisma.noShowCard.updateMany({
    where: { userId, kind: CardKind.Yellow, status: CardStatus.Active, acknowledgedAt: null },
    data:  { acknowledgedAt: now, acknowledgedEventId: eventId },
  })
}

/** Machine-readable body for a refused join, so the client can say why. */
export function gateErrorBody(gate: Exclude<GateResult, { ok: true }>) {
  if (gate.code === 'red_card_blocked') {
    return {
      error: `RSVPs are paused until ${fmt(gate.restrictionEndsAt)}`,
      code:  gate.code,
      cardId: gate.cardId,
      restrictionEndsAt: gate.restrictionEndsAt.toISOString(),
      appealDeadlineAt:  gate.appealDeadlineAt?.toISOString() ?? null,
    }
  }
  return {
    error:  "Please confirm you'll actually come",
    code:   gate.code,
    cardId: gate.cardId,
  }
}

// ── Settlement (cron) ───────────────────────────────────────────────────────

export interface SettleResult {
  eventId:  string
  skipped?: 'already_processed' | 'not_live' | 'too_early' | 'no_checkins' | 'low_checkin'
  noShows:  number
  yellow:   number
  red:      number
}

/**
 * Settle one event's attendance: mark no-shows, issue cards (free events
 * only), stamp the event. All of it in one transaction, so a crash leaves
 * either nothing or everything — and the stamp means it never runs twice.
 *
 * Zero or too few check-ins (NO_SHOW_MIN_CHECKIN_RATIO) is NOT stamped: the
 * host may still be scanning people in the morning after, and the next
 * hourly run will pick the event up. It falls out of the candidate window
 * on its own after the lookback.
 */
export async function settleEvent(eventId: string, now: Date = new Date()): Promise<SettleResult> {
  const none = { eventId, noShows: 0, yellow: 0, red: 0 }
  const event = await prisma.event.findUnique({
    where:  { id: eventId },
    select: {
      id: true, date: true, time: true, endTime: true, hostId: true, price: true, memberPrice: true,
      status: true, cancelledAt: true, noShowProcessedAt: true,
      city:    { select: { timezone: true } },
      cohosts: { select: { userId: true } },
    },
  })
  if (!event) return none
  if (event.noShowProcessedAt) return { ...none, skipped: 'already_processed' }
  if (event.cancelledAt || !['published', 'archived'].includes(event.status)) return { ...none, skipped: 'not_live' }

  const tz       = event.city?.timezone ?? DEFAULT_TZ
  const startsAt = eventStartsAt(event, tz)
  const endsAt   = eventEndsAt(event, tz)
  if (endsAt.getTime() + NO_SHOW_PROCESSING_DELAY_HOURS * HOUR > now.getTime()) return { ...none, skipped: 'too_early' }

  // Approved rows decide "did check-in run"; cancelled rows are only ever
  // late cancels by the member. Pending and removed rows can't be no-shows.
  const attendees = await prisma.eventAttendee.findMany({
    where:  { eventId, status: { in: ['approved', 'cancelled'] } },
    select: { id: true, userId: true, status: true, checkedIn: true, cancelledAt: true, cancelledBy: true },
  })
  const staff    = new Set([event.hostId, ...event.cohosts.map(c => c.userId)])
  const room     = attendees.filter(a => a.status === 'approved' && !staff.has(a.userId))
  const checkIns = room.filter(a => a.checkedIn).length
  if (checkIns === 0) return { ...none, skipped: 'no_checkins' }
  if (!checkInIsCredible(checkIns, room.length)) return { ...none, skipped: 'low_checkin' }

  const noShows  = attendees.filter(a => !staff.has(a.userId) && isNoShow(a, startsAt))
  const free     = isFreeEvent(event)

  // Everything the colour decision needs is read up front, in two queries,
  // so the transaction is three statements however big the room — a
  // per-row loop inside it ran into the interactive-tx timeout on a large
  // event. The window is the same for every row here (this event's end),
  // so one query per event serves all of them. Cards already issued for
  // these rows (a partial earlier run) are left alone.
  const ids   = noShows.map(a => a.id)
  const users = [...new Set(noShows.map(a => a.userId))]
  const [existing, priorRows] = free && noShows.length ? await Promise.all([
    prisma.noShowCard.findMany({ where: { attendeeId: { in: ids } }, select: { attendeeId: true } }),
    prisma.noShowCard.findMany({
      where: {
        userId:     { in: users },
        status:     { in: COUNTING_STATUSES },
        occurredAt: { gte: windowStart(endsAt), lte: endsAt },
        attendeeId: { notIn: ids },
      },
      select: { userId: true },
    }),
  ]) : [[], []]
  const carded = new Set(existing.map(e => e.attendeeId))
  const prior  = new Map<string, number>()
  for (const r of priorRows) prior.set(r.userId, (prior.get(r.userId) ?? 0) + 1)

  const cards = free ? noShows.filter(a => !carded.has(a.id)).map(a => {
    const kind = cardKindFor(prior.get(a.userId) ?? 0)
    return {
      userId: a.userId, kind, attendeeId: a.id, eventId, occurredAt: endsAt, issuedAt: now,
      ...(kind === CardKind.Red ? redCardWindows(now) : {}),
    }
  }) : []

  await prisma.$transaction(async (tx) => {
    if (noShows.length) {
      await tx.eventAttendee.updateMany({
        where: { id: { in: ids } },
        data:  { attendance: Attendance.NoShow },
      })
    }
    // skipDuplicates: the unique on attendeeId is the real guard against an
    // overlapping run — a duplicate simply isn't written.
    if (cards.length) await tx.noShowCard.createMany({ data: cards, skipDuplicates: true })
    await tx.event.update({ where: { id: eventId }, data: { noShowProcessedAt: now } })
  })

  return {
    eventId, noShows: noShows.length,
    yellow: cards.filter(c => c.kind === CardKind.Yellow).length,
    red:    cards.filter(c => c.kind === CardKind.Red).length,
  }
}

/** Events that may be due for settlement: recent, live, not yet stamped. */
async function candidateEvents(now: Date) {
  const cities = await prisma.city.findMany({ select: { id: true, timezone: true } })
  const rows = await Promise.all(cities.map(c => prisma.event.findMany({
    where: {
      cityId: c.id,
      status: { in: ['published', 'archived'] },
      cancelledAt: null,
      noShowProcessedAt: null,
      date: { gte: todayInTz(c.timezone, -(NO_SHOW_PROCESSING_LOOKBACK_DAYS + 1)), lte: todayInTz(c.timezone) },
    },
    select: { id: true, date: true, time: true, endTime: true },
  }).then(evs => evs.map(e => ({ ...e, tz: c.timezone })))))
  const floor = now.getTime() - NO_SHOW_PROCESSING_LOOKBACK_DAYS * DAY
  return rows.flat().filter(e => {
    const end = eventEndsAt(e, e.tz).getTime()
    return end >= floor && end + NO_SHOW_PROCESSING_DELAY_HOURS * HOUR <= now.getTime()
  })
}

/** Tell members about cards issued since the last run. Stamped per card, after the send. */
export async function notifyIssuedCards(): Promise<number> {
  const cards = await prisma.noShowCard.findMany({
    where:   { notifiedAt: null, status: { in: [CardStatus.Active, CardStatus.AppealPending] } },
    include: { user: { select: { id: true, name: true, email: true } }, event: { select: { title: true, emoji: true } } },
  })
  for (const c of cards) {
    const emoji = c.event.emoji ?? '📅'
    if (c.kind === CardKind.Yellow) {
      await createNotification(c.userId, 'no_show_yellow',
        `${emoji} We missed you at ${c.event.title}`,
        `Your spot went unused and check-in ran. Next time you RSVP we'll ask you to confirm you're coming — that's all.`,
        '/no-show')
      sendYellowCardEmail(c.user.id, c.user.email, c.user.name ?? 'Member', c.event.title, emoji)
        .catch(async err => {
          console.error('[no-show] sendYellowCardEmail failed', { cardId: c.id, err: String(err) })
          await recordEmailFailure({ helper: 'sendYellowCardEmail', recipient: c.user.email, error: err, context: { cardId: c.id } })
        })
    } else if (c.appealDeadlineAt && c.restrictionStartsAt && c.restrictionEndsAt) {
      await createNotification(c.userId, 'no_show_red',
        `${emoji} Second no-show — RSVPs paused from ${fmt(c.restrictionStartsAt)}`,
        `Until ${fmt(c.restrictionEndsAt)} you won't be able to RSVP or join waitlists. You can appeal until ${fmt(c.appealDeadlineAt)}; nothing is paused while an appeal is open.`,
        '/no-show')
      sendRedCardEmail(c.user.id, c.user.email, c.user.name ?? 'Member', c.event.title, emoji,
        { appealDeadlineAt: c.appealDeadlineAt, restrictionStartsAt: c.restrictionStartsAt, restrictionEndsAt: c.restrictionEndsAt })
        .catch(async err => {
          console.error('[no-show] sendRedCardEmail failed', { cardId: c.id, err: String(err) })
          await recordEmailFailure({ helper: 'sendRedCardEmail', recipient: c.user.email, error: err, context: { cardId: c.id } })
        })
    }
    await prisma.noShowCard.update({ where: { id: c.id }, data: { notifiedAt: new Date() } })
  }
  return cards.length
}

/**
 * Red cards whose appeal window has closed without an appeal: the block is
 * now in force. Tell the member, and take them off every waitlist — a paused
 * member can't hold a place in a queue either. Stamped so it happens once.
 */
export async function activateRedCards(now: Date = new Date()): Promise<number> {
  const due = await prisma.noShowCard.findMany({
    where: {
      kind: CardKind.Red, status: CardStatus.Active, restrictionNotifiedAt: null,
      restrictionStartsAt: { lte: now }, restrictionEndsAt: { gt: now },
    },
    select: { id: true, userId: true, restrictionEndsAt: true },
  })
  for (const c of due) {
    const entries = await prisma.waitlistEntry.findMany({ where: { userId: c.userId }, select: { id: true } })
    if (entries.length) {
      await prisma.waitlistEntry.deleteMany({ where: { id: { in: entries.map(e => e.id) } } })
      await createNotification(c.userId, 'no_show_waitlist_removed',
        'Removed from waitlists',
        `You were on ${entries.length === 1 ? 'a waitlist' : `${entries.length} waitlists`}; those places are released while RSVPs are paused.`,
        '/no-show')
    }
    await createNotification(c.userId, 'no_show_restriction_active',
      `RSVPs paused until ${fmt(c.restrictionEndsAt!)}`,
      'The appeal window closed. Everything else stays open — events, clubs, messages — and RSVPs come back automatically.',
      '/no-show')
    await prisma.noShowCard.update({ where: { id: c.id }, data: { restrictionNotifiedAt: now } })
  }
  return due.length
}

/** Blocks that have run their course, and yellows that fell out of the window. */
export async function expireCards(now: Date = new Date()): Promise<number> {
  const [red, yellow] = await Promise.all([
    prisma.noShowCard.updateMany({
      where: { kind: CardKind.Red, status: CardStatus.Active, restrictionEndsAt: { lt: now } },
      data:  { status: CardStatus.Expired },
    }),
    prisma.noShowCard.updateMany({
      where: { kind: CardKind.Yellow, status: CardStatus.Active, occurredAt: { lt: windowStart(now) } },
      data:  { status: CardStatus.Expired },
    }),
  ])
  return red.count + yellow.count
}

/** The hourly job. Each pass is idempotent on its own stamp. */
export async function sweepNoShows(now: Date = new Date()) {
  const candidates = await candidateEvents(now)
  const results: SettleResult[] = []
  const errors: string[] = []
  // One event's failure must not take the hour's notifications, activations
  // and expiries down with it — nor the events queued behind it.
  for (const e of candidates) {
    try { results.push(await settleEvent(e.id, now)) }
    catch (err) {
      console.error('[no-show] settleEvent failed', { eventId: e.id, err: String(err) })
      errors.push(e.id)
    }
  }
  const settled   = results.filter(r => !r.skipped)
  const notified  = await notifyIssuedCards()
  const activated = await activateRedCards(now)
  const expired   = await expireCards(now)
  return {
    now:       now.toISOString(),
    candidates: candidates.length,
    settled:   settled.length,
    noShows:   settled.reduce((s, r) => s + r.noShows, 0),
    yellow:    settled.reduce((s, r) => s + r.yellow, 0),
    red:       settled.reduce((s, r) => s + r.red, 0),
    skipped:   results.filter(r => r.skipped).map(r => `${r.eventId}:${r.skipped}`),
    errors,
    notified, activated, expired,
  }
}

// ── Interventions ───────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0] extends (tx: infer T) => unknown ? (tx: T) => unknown : never>[0]

/**
 * When a card stops counting (waived, overturned, appeal accepted), any red
 * card of the same member from the same moment or later that only turned
 * red because of it is downgraded to yellow: a block built on a mistake
 * must not stand. Same-instant cards (two events with no end time both
 * resolve to 23:59) are included, hence `gte` plus the id exclusion.
 * Returns what was downgraded so the caller can tell the member.
 */
async function downgradeDependentReds(
  tx: Tx, cleared: { id: string; userId: string; occurredAt: Date }, now: Date, because: string,
): Promise<{ userId: string; title: string }[]> {
  const laterReds = await tx.noShowCard.findMany({
    where: {
      userId: cleared.userId, kind: CardKind.Red, id: { not: cleared.id },
      status: { in: [CardStatus.Active, CardStatus.AppealPending] },
      occurredAt: { gte: cleared.occurredAt },
    },
    include: { event: { select: { title: true } } },
  })
  const out: { userId: string; title: string }[] = []
  for (const r of laterReds) {
    const prior = await tx.noShowCard.count({
      where: {
        userId: r.userId, status: { in: COUNTING_STATUSES }, id: { not: r.id },
        occurredAt: { gte: windowStart(r.occurredAt), lte: r.occurredAt },
      },
    })
    if (prior > 0) continue
    await tx.noShowCard.update({
      where: { id: r.id },
      data:  {
        kind: CardKind.Yellow, status: CardStatus.Active,
        appealDeadlineAt: null, restrictionStartsAt: null, restrictionEndsAt: null, restrictionNotifiedAt: null,
        appealStatus: r.appealStatus === 'pending' ? 'accepted' : r.appealStatus,
        resolvedAt: r.appealStatus === 'pending' ? now : r.resolvedAt,
        resolutionNote: r.appealStatus === 'pending' ? because : r.resolutionNote,
      },
    })
    out.push({ userId: r.userId, title: r.event.title })
  }
  return out
}

export type WaiveOutcome = 'ok' | 'not_found' | 'not_waivable'

/**
 * A host clears a card from their own event: the attendance result was
 * wrong. The card is closed, not deleted, and the attendee row keeps its
 * 'no_show' mark — the trail stays. If a LATER red card only turned red
 * because of the one just waived, it is downgraded to yellow: a block built
 * on a mistake should not stand.
 */
export async function waiveCard(opts: {
  cardId: string
  actor:  { id: string; name: string }
  reason: string
}): Promise<WaiveOutcome> {
  const card = await prisma.noShowCard.findUnique({
    where:   { id: opts.cardId },
    include: { event: { select: { title: true, emoji: true } } },
  })
  if (!card) return 'not_found'
  if (card.status !== CardStatus.Active && card.status !== CardStatus.AppealPending) return 'not_waivable'

  const now = new Date()
  // The waiver and any downgrade it causes commit together: a red card that
  // only stood on this one must not survive a crash between the two writes.
  const downgraded = await prisma.$transaction(async (tx) => {
    await tx.noShowCard.update({
      where: { id: card.id },
      data:  { status: CardStatus.Waived, waivedAt: now, waivedById: opts.actor.id, waiveReason: opts.reason },
    })
    return downgradeDependentReds(tx, card, now, `Earlier no-show cleared ("${card.event.title}")`)
  })

  for (const d of downgraded) {
    await createNotification(d.userId, 'no_show_downgraded',
      'Your RSVP pause has been lifted',
      `The earlier no-show at "${card.event.title}" was cleared, so "${d.title}" now counts as a first one — a warning only.`,
      '/no-show')
  }
  writeAudit(opts.actor.id, opts.actor.name, 'no_show.waive', card.id, 'no_show_card',
    { userId: card.userId, eventId: card.eventId, kind: card.kind, reason: opts.reason, downgraded: downgraded.length },
    `Waived ${card.kind} card for "${card.event.title}": ${opts.reason}`)
  await createNotification(card.userId, 'no_show_waived',
    `${card.event.emoji ?? '📅'} No-show cleared for ${card.event.title}`,
    'That no-show no longer counts against you.',
    '/no-show')
  return 'ok'
}

export type AppealOutcome = 'ok' | 'not_found' | 'not_appealable' | 'window_closed' | 'already_appealed'

/** A member appeals a red card, inside the window. Pauses nothing while open. */
export async function submitAppeal(cardId: string, userId: string, note: string, now: Date = new Date()): Promise<AppealOutcome> {
  const card = await prisma.noShowCard.findFirst({
    where:   { id: cardId, userId },
    include: { event: { select: { title: true } }, user: { select: { name: true, cityId: true } } },
  })
  if (!card) return 'not_found'
  if (card.appealStatus) return 'already_appealed'
  if (card.kind !== CardKind.Red || card.status !== CardStatus.Active || !card.appealDeadlineAt) return 'not_appealable'
  if (now.getTime() > card.appealDeadlineAt.getTime()) return 'window_closed'

  await prisma.noShowCard.update({
    where: { id: card.id },
    data:  { appealNote: note, appealedAt: now, appealStatus: 'pending', status: CardStatus.AppealPending },
  })
  const admins = await prisma.user.findMany({ where: { role: 'admin', status: 'approved' }, select: { id: true } })
  for (const a of admins) {
    createNotification(a.id, 'no_show_appeal',
      'No-show appeal to review',
      `${card.user.name ?? 'A member'} is appealing a red card from "${card.event.title}".`,
      '/admin/no-shows').catch(() => {})
  }
  return 'ok'
}

export type ResolveAction = 'accept' | 'reject' | 'overturn'
export type ResolveOutcome = 'ok' | 'not_found' | 'not_pending' | 'not_open'

/**
 * Admin decides. Accepting an appeal (or overturning a card outright) closes
 * it for good. Rejecting re-arms the block — starting now if the window has
 * already passed, never earlier than the deadline — and lets the activation
 * pass do the telling and the waitlist clean-up.
 */
export async function resolveCard(opts: {
  cardId: string
  action: ResolveAction
  actor:  { id: string; name: string }
  note?:  string
}): Promise<ResolveOutcome> {
  const card = await prisma.noShowCard.findUnique({
    where:   { id: opts.cardId },
    include: { event: { select: { title: true } } },
  })
  if (!card) return 'not_found'
  const now = new Date()

  let downgraded: { userId: string; title: string }[] = []
  if (opts.action === 'overturn') {
    if (card.status !== CardStatus.Active && card.status !== CardStatus.AppealPending) return 'not_open'
    downgraded = await prisma.$transaction(async (tx) => {
      await tx.noShowCard.update({
        where: { id: card.id },
        data:  {
          status: CardStatus.Overturned, resolvedAt: now, resolvedById: opts.actor.id, resolutionNote: opts.note ?? null,
          appealStatus: card.appealStatus === 'pending' ? 'accepted' : card.appealStatus,
        },
      })
      return downgradeDependentReds(tx, card, now, `Earlier card overturned ("${card.event.title}")`)
    })
  } else {
    if (card.appealStatus !== 'pending' || card.status !== CardStatus.AppealPending) return 'not_pending'
    if (opts.action === 'accept') {
      downgraded = await prisma.$transaction(async (tx) => {
        await tx.noShowCard.update({
          where: { id: card.id },
          data:  { status: CardStatus.Overturned, appealStatus: 'accepted', resolvedAt: now, resolvedById: opts.actor.id, resolutionNote: opts.note ?? null },
        })
        return downgradeDependentReds(tx, card, now, `Earlier appeal accepted ("${card.event.title}")`)
      })
    } else {
      const windows = restrictionAfterRejectedAppeal(card.appealDeadlineAt ?? now, now)
      await prisma.noShowCard.update({
        where: { id: card.id },
        data:  {
          status: CardStatus.Active, appealStatus: 'rejected', resolvedAt: now, resolvedById: opts.actor.id, resolutionNote: opts.note ?? null,
          ...windows, restrictionNotifiedAt: null,
        },
      })
    }
  }

  for (const d of downgraded) {
    await createNotification(d.userId, 'no_show_downgraded',
      'Your RSVP pause has been lifted',
      `The earlier no-show at "${card.event.title}" was cleared, so "${d.title}" now counts as a first one — a warning only.`,
      '/no-show')
  }
  writeAudit(opts.actor.id, opts.actor.name, `no_show.${opts.action}`, card.id, 'no_show_card',
    { userId: card.userId, eventId: card.eventId, note: opts.note ?? null },
    `${opts.action === 'reject' ? 'Rejected appeal on' : opts.action === 'accept' ? 'Accepted appeal on' : 'Overturned'} ${card.kind} card for "${card.event.title}"`)
  await createNotification(card.userId, 'no_show_appeal_resolved',
    opts.action === 'reject' ? 'Appeal not accepted' : 'No-show card cleared',
    opts.action === 'reject'
      ? `The red card from "${card.event.title}" stands. RSVPs pause from ${fmt(restrictionAfterRejectedAppeal(card.appealDeadlineAt ?? now, now).restrictionStartsAt)}.${opts.note ? ` Note: ${opts.note}` : ''}`
      : `The card from "${card.event.title}" no longer counts against you.${opts.note ? ` Note: ${opts.note}` : ''}`,
    '/no-show')
  return 'ok'
}

// ── Member-facing summary ───────────────────────────────────────────────────

/** What the banner and the /no-show page show: the gate plus the live cards. */
export async function memberNoShowStatus(userId: string, now: Date = new Date()) {
  const cards = await prisma.noShowCard.findMany({
    where:   { userId, status: { in: [CardStatus.Active, CardStatus.AppealPending] } },
    orderBy: { occurredAt: 'desc' },
    include: { event: { select: { id: true, title: true, emoji: true, date: true } } },
  })
  return {
    gate:  evaluateGate(cards, now),
    cards: cards.map(c => ({
      id: c.id, kind: c.kind, status: c.status, occurredAt: c.occurredAt,
      event: c.event,
      acknowledgedAt: c.acknowledgedAt,
      appealDeadlineAt: c.appealDeadlineAt, appealStatus: c.appealStatus, appealedAt: c.appealedAt,
      restrictionStartsAt: c.restrictionStartsAt, restrictionEndsAt: c.restrictionEndsAt,
      canAppeal: c.kind === CardKind.Red && c.status === CardStatus.Active && !c.appealStatus
        && !!c.appealDeadlineAt && now.getTime() <= c.appealDeadlineAt.getTime(),
    })),
  }
}
