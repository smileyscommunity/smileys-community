import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendReconfirmEmail, sendSpotReleasedEmail, recordEmailFailure } from '@/lib/email'
import { eventStartsAt } from '@/lib/eventTime'
import { dayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { announceSpotOpened } from '@/lib/spotOpened'
import { reconfirmUrl } from '@/lib/reconfirmToken'
import {
  isFreeEvent, RECONFIRM_ASK_HOURS_BEFORE, RECONFIRM_RELEASE_HOURS_BEFORE, RECONFIRM_MIN_LEAD_HOURS,
} from '@/lib/noShowPolicy'

// ── Day-before reconfirmation ───────────────────────────────────────────────
//
// The no-show cards deal with an empty seat after the fact. This is the part
// that fills it: on a free, limited-spot event every approved attendee is
// asked "still coming?" the day before, and a seat that was asked and never
// answered is released to the waitlist at the cancellation cutoff — but only
// when someone is actually waiting. Nobody loses a spot to an empty queue.
// A released member is told, can rejoin, and is never a no-show for it.

const HOUR = 60 * 60 * 1000

/**
 * Which events take part: free, limited spots, live, and self-serve. An
 * approval-required event has a host vetting every seat; releasing one to
 * whoever claims first would put the system in the host's chair.
 */
export function needsReconfirmation(e: {
  price: number; memberPrice?: number | null; limitedSpots: boolean; status: string; cancelledAt: Date | null;
  approvalRequired: boolean; time: string
}): boolean {
  // A start time that doesn't parse ("TBA") would read as midnight and
  // release seats a day early; such an event simply isn't asked.
  return isFreeEvent(e) && e.limitedSpots && e.status === 'published' && !e.cancelledAt && !e.approvalRequired
    && /^\d{1,2}:\d{2}/.test(e.time)
}

export type ReconfirmPhase = 'early' | 'ask' | 'late' | 'release' | 'started'

/**
 * Where an event sits relative to its start:
 *   early    — more than ASK hours away: nothing yet
 *   ask      — inside the ask window, with enough lead to answer fairly
 *   late     — past the minimum lead but before the cutoff: too late to ask
 *              anyone new, too early to release anyone
 *   release  — at or inside the cutoff: unanswered seats go to the waitlist
 *   started  — the event has begun
 */
export function reconfirmPhase(startsAt: Date, now: Date): ReconfirmPhase {
  const hours = (startsAt.getTime() - now.getTime()) / HOUR
  if (hours <= 0) return 'started'
  if (hours <= RECONFIRM_RELEASE_HOURS_BEFORE) return 'release'
  if (hours <= RECONFIRM_MIN_LEAD_HOURS) return 'late'
  if (hours <= RECONFIRM_ASK_HOURS_BEFORE) return 'ask'
  return 'early'
}

const fmtTime = (d: Date, tz: string) =>
  d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })
const fmtWhen = (d: Date, tz: string) =>
  d.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })

async function staffIds(eventId: string, hostId: string): Promise<Set<string>> {
  const cohosts = await prisma.eventCoHost.findMany({ where: { eventId }, select: { userId: true } })
  return new Set([hostId, ...cohosts.map(c => c.userId)])
}

/** Ask everyone approved and not yet asked. Stamped per row, so once only. */
export async function askEvent(event: {
  id: string; title: string; emoji: string | null; hostId: string; date: string; time: string
}, startsAt: Date, tz: string, now: Date): Promise<number> {
  const staff = await staffIds(event.id, event.hostId)
  const rows = await prisma.eventAttendee.findMany({
    where:   { eventId: event.id, status: 'approved', reconfirmAskedAt: null },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  const deadline = new Date(startsAt.getTime() - RECONFIRM_RELEASE_HOURS_BEFORE * HOUR)
  let asked = 0
  for (const a of rows) {
    if (staff.has(a.userId)) continue
    // Stamp first: a crash after the stamp costs one member their ask, a
    // crash before it would re-send on the next run.
    await prisma.eventAttendee.update({ where: { id: a.id }, data: { reconfirmAskedAt: now } })
    const emoji = event.emoji ?? '📅'
    const body  = `Tap to confirm your spot. Unanswered spots may go to the waitlist from ${fmtTime(deadline, tz)}.`
    // createNotification sends the push itself (and honours quiet hours).
    await createNotification(a.userId, 'reconfirm_ask', `${emoji} Still coming to ${event.title} tomorrow?`, body, `/events/${event.id}`)
    sendReconfirmEmail(a.user.id, a.user.email, a.user.name ?? 'Member', event.title, emoji,
      fmtWhen(startsAt, tz), fmtTime(deadline, tz), reconfirmUrl(a.user.id, event.id), event.id)
      .catch(async err => {
        console.error('[reconfirm] sendReconfirmEmail failed', { eventId: event.id, userId: a.userId, err: String(err) })
        await recordEmailFailure({ helper: 'sendReconfirmEmail', recipient: a.user.email, error: err, context: { eventId: event.id, userId: a.userId } })
      })
    asked++
  }
  return asked
}

/**
 * Release asked-but-unanswered seats — only if someone is waiting. Each
 * released row becomes 'removed' by 'system' (not a no-show), the member is
 * told, and the seats go out as one "spot opened" fanout.
 */
export async function releaseEvent(event: {
  id: string; title: string; emoji: string | null; hostId: string
}, now: Date = new Date()): Promise<number> {
  const waiting = await prisma.waitlistEntry.count({ where: { eventId: event.id } })
  if (waiting === 0) return 0
  const staff = await staffIds(event.id, event.hostId)
  const rows = await prisma.eventAttendee.findMany({
    where:   { eventId: event.id, status: 'approved', reconfirmAskedAt: { not: null }, reconfirmedAt: null },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  let released = 0
  for (const a of rows) {
    if (staff.has(a.userId)) continue
    // The answer is re-checked in the write itself: a member who tapped
    // "yes" between the read above and this line keeps the seat.
    const { count } = await prisma.eventAttendee.updateMany({
      where: { id: a.id, status: 'approved', reconfirmAskedAt: { not: null }, reconfirmedAt: null },
      data:  { status: 'removed', cancelledAt: now, cancelledBy: 'system' },
    })
    if (count === 0) continue
    const emoji = event.emoji ?? '📅'
    await createNotification(a.userId, 'reconfirm_released',
      `${emoji} Your spot at ${event.title} went to the waitlist`,
      'We asked yesterday and didn\'t hear back, and someone was waiting. Still want to come? You can rejoin if a spot is open.',
      `/events/${event.id}`)
    sendSpotReleasedEmail(a.user.id, a.user.email, a.user.name ?? 'Member', event.title, emoji, event.id)
      .catch(async err => {
        console.error('[reconfirm] sendSpotReleasedEmail failed', { eventId: event.id, userId: a.userId, err: String(err) })
        await recordEmailFailure({ helper: 'sendSpotReleasedEmail', recipient: a.user.email, error: err, context: { eventId: event.id, userId: a.userId } })
      })
    released++
  }
  if (released > 0) await announceSpotOpened(event.id)
  return released
}

/** The hourly job: asks in the ask window, releases inside the cutoff. */
export async function sweepReconfirm(now: Date = new Date()) {
  const cities = await prisma.city.findMany({ select: { id: true, timezone: true } })
  const twoDays = new Date(now.getTime() + 2 * 24 * HOUR)
  const events = (await Promise.all(cities.map(c => prisma.event.findMany({
    where: {
      cityId: c.id, status: 'published', cancelledAt: null, price: 0, limitedSpots: true, approvalRequired: false,
      date: { gte: dayInTz(now, c.timezone), lte: dayInTz(twoDays, c.timezone) },
    },
    select: { id: true, title: true, emoji: true, hostId: true, date: true, time: true, endTime: true, price: true, memberPrice: true, limitedSpots: true, status: true, cancelledAt: true, approvalRequired: true },
  }).then(rows => rows.map(e => ({ ...e, tz: c.timezone ?? DEFAULT_TZ })))))).flat()

  let asked = 0, released = 0
  const errors: string[] = []
  for (const e of events) {
    if (!needsReconfirmation(e)) continue
    try {
      const phase = reconfirmPhase(eventStartsAt(e, e.tz), now)
      if (phase === 'ask')     asked    += await askEvent(e, eventStartsAt(e, e.tz), e.tz, now)
      if (phase === 'release') released += await releaseEvent(e, now)
    } catch (err) {
      console.error('[reconfirm] event failed', { eventId: e.id, err: String(err) })
      errors.push(e.id)
    }
  }
  return { now: now.toISOString(), events: events.length, asked, released, errors }
}

export type ConfirmOutcome = 'ok' | 'released' | 'not_attending'

/** The member's answer. Idempotent; a released seat is reported as such. */
export async function confirmAttendance(userId: string, eventId: string, now: Date = new Date()): Promise<ConfirmOutcome> {
  const { count } = await prisma.eventAttendee.updateMany({
    where: { userId, eventId, status: 'approved', reconfirmedAt: null },
    data:  { reconfirmedAt: now },
  })
  if (count > 0) return 'ok'
  const row = await prisma.eventAttendee.findUnique({
    where:  { userId_eventId: { userId, eventId } },
    select: { status: true, cancelledBy: true, reconfirmedAt: true },
  })
  if (row?.status === 'approved') return 'ok'                       // already confirmed
  if (row?.status === 'removed' && row.cancelledBy === 'system') return 'released'
  return 'not_attending'
}
