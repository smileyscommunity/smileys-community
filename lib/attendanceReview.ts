import { prisma } from '@/lib/prisma'
import { standingEvents, reviewSentKey, type SweepEvent } from '@/lib/standing'
import {
  attendanceReviewOpensAt, attendanceSettlesAt, checkInRan, unmarkedGuests,
  CHECK_IN_RAN_RATIO, doorKey,
} from '@/lib/standingPolicy'
import { noShowExemptionReason, eventRunners } from '@/lib/noShowPolicy'
import { AttendeeStatus } from '@/lib/constants'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { eventEndsAt } from '@/lib/eventTime'

const DAY = 24 * 60 * 60 * 1000

// The attendance review queue — the one screen that shows a room BEFORE it
// settles, which is the only window in which anybody can still fix it.
//
// Everything here was previously invisible outside the host's bell: whether
// the door cleared the ratio, who is unmarked, who was actually warned, and
// how long is left. A host reading "8 not checked in" had no way to see that
// one of those eight was never told; an admin had no way to see the event at
// all until the offences had already been written.

export type ReviewStage = 'running' | 'review' | 'settled'

export interface ReviewGuest {
  attendeeId: string
  userId:     string
  name:       string
  /** The warning reached them (or was deliberately skipped — see `warned`). */
  warned:     boolean
  saysCame:   boolean
}

export interface ReviewRow {
  eventId:      string
  title:        string
  emoji:        string
  date:         string
  hostId:       string
  hostName:     string | null
  stage:        ReviewStage
  room:         number
  scanned:      number
  ratio:        number
  /** Did the door clear the bar? Below it nothing settles as a no-show. */
  checkInRan:   boolean
  bar:          number
  unmarked:     ReviewGuest[]
  /** The host list went out for this event. */
  listSent:     boolean
  opensAt:      string
  settlesAt:    string
  endsAt:       string
}

const tzOf = (e: SweepEvent) => e.city?.timezone ?? DEFAULT_TZ

function stageOf(e: SweepEvent, now: Date): ReviewStage {
  const tz = tzOf(e)
  if (attendanceSettlesAt(e, tz).getTime() <= now.getTime()) return 'settled'
  if (attendanceReviewOpensAt(e, tz).getTime() <= now.getTime()) return 'review'
  return 'running'
}

/**
 * How long a settled room stays on the queue by default. A host can still mark
 * one for HOST_MARKING_WINDOW_DAYS, but a month of closed rooms is a wall of
 * history in front of the few that need a hand — `includeSettled` reaches them.
 */
export const SETTLED_TAIL_DAYS = 7
/** Ceiling on one response. This is a worklist, not an archive. */
export const REVIEW_PAGE_LIMIT = 60

export interface ReviewQuery {
  /** Also return settled rooms older than SETTLED_TAIL_DAYS, back to the sweep's window. */
  includeSettled?: boolean
  limit?: number
}

/**
 * Every event the standing sweep is holding, soonest deadline first, with the
 * numbers the decision actually turns on. `eventIds` narrows it to what a host
 * runs; an admin passes nothing and sees all of them.
 *
 * Two things keep this from degrading as the community runs more events.
 *
 * The window is trimmed BEFORE any per-event work: the sweep reads a month
 * back so a late mark still records, but a room that settled three weeks ago
 * is history and costs exactly as much to read as tonight's.
 *
 * And every lookup is batched across the page. This used to read the room, the
 * warnings, the claims and the list-sent flag once PER EVENT — four queries an
 * event against a month of them. At 71 events that was ~285 round trips for
 * one page, growing with every event ever run.
 */
export async function attendanceReviewRows(
  now: Date = new Date(),
  eventIds?: string[],
  // A moderator's own city: every other staff list is scoped this way, and
  // this one handed any moderator every city's rooms and guest list.
  cityId?: string,
  q: ReviewQuery = {},
): Promise<{ rows: ReviewRow[]; total: number }> {
  let events = await standingEvents(now)
  // Either list narrows it; both is their union — a moderator's city plus
  // the rooms they run anywhere (a host in several cities reviews them all).
  if (eventIds !== undefined || cityId !== undefined) {
    const allowed = new Set(eventIds ?? [])
    events = events.filter(e => allowed.has(e.id) || (cityId !== undefined && e.cityId === cityId))
  }
  const total = events.length
  if (events.length === 0) return { rows: [], total: 0 }

  const tailFrom = now.getTime() - SETTLED_TAIL_DAYS * DAY
  if (!q.includeSettled) {
    events = events.filter(e => {
      const settles = attendanceSettlesAt(e, tzOf(e)).getTime()
      return settles > now.getTime() || settles >= tailFrom
    })
  }
  // Soonest deadline first: what is about to settle is what still needs a hand.
  events = events
    .sort((a, b) => attendanceSettlesAt(a, tzOf(a)).getTime() - attendanceSettlesAt(b, tzOf(b)).getTime())
    .slice(0, q.limit ?? REVIEW_PAGE_LIMIT)
  if (events.length === 0) return { rows: [], total }

  const ids = events.map(e => e.id)

  // ── Four batched reads for the whole page, whatever its length ────────────
  const [hosts, emojis, attendees, warnedRows, claimRows] = await Promise.all([
    prisma.user.findMany({
      where:  { id: { in: [...new Set(events.map(e => e.hostId).filter((h): h is string => !!h))] } },
      select: { id: true, name: true },
    }),
    prisma.event.findMany({ where: { id: { in: ids } }, select: { id: true, emoji: true } }),
    prisma.eventAttendee.findMany({
      where:   { eventId: { in: ids }, status: AttendeeStatus.Approved },
      orderBy: { joinedAt: 'asc' },
      select:  { id: true, eventId: true, userId: true, checkedIn: true, attendance: true, user: { select: { name: true, role: true } } },
    }),
    prisma.notification.findMany({
      where:  { type: 'attendance_check', OR: ids.map(id => ({ link: { contains: id } })) },
      select: { userId: true, link: true },
    }),
    prisma.rateLimit.findMany({
      where:  { OR: [
        ...ids.map(id => ({ key: { startsWith: `attendance-says-came:${id}:` } })),
        { key: { in: ids.map(reviewSentKey) } },
      ] },
      select: { key: true },
    }),
  ])

  const hostName = (id: string | null) => (id ? hosts.find(h => h.id === id)?.name ?? null : null)
  const byEvent  = new Map<string, typeof attendees>()
  for (const a of attendees) {
    const list = byEvent.get(a.eventId) ?? []
    list.push(a)
    byEvent.set(a.eventId, list)
  }
  // A notification's link is /events/<id>, so the id is the last path segment.
  const warnedBy = new Map<string, Set<string>>()
  for (const n of warnedRows) {
    const id = (n.link ?? '').split('/').filter(Boolean).pop() ?? ''
    if (!warnedBy.has(id)) warnedBy.set(id, new Set())
    warnedBy.get(id)!.add(n.userId)
  }
  const saysCameBy = new Map<string, Set<string>>()
  const listSent   = new Set<string>()
  for (const r of claimRows) {
    if (r.key.startsWith('attendance-says-came:')) {
      const [, eventId, userId] = r.key.split(':')
      if (!saysCameBy.has(eventId)) saysCameBy.set(eventId, new Set())
      saysCameBy.get(eventId)!.add(userId)
    } else {
      listSent.add(r.key)
    }
  }

  const rows: ReviewRow[] = events.map(e => {
    const tz      = tzOf(e)
    const runners = eventRunners({ ...e, club: e.club?.isActive ? e.club : null })
    const room    = (byEvent.get(e.id) ?? []).map(r => ({
      ...r, exempt: noShowExemptionReason(r.userId, r.user?.role, runners) !== null,
    }))
    const guests  = room.filter(r => !r.exempt)
    const missing = unmarkedGuests(room)
    const warned  = warnedBy.get(e.id) ?? new Set<string>()
    const came    = saysCameBy.get(e.id) ?? new Set<string>()
    const scanned = guests.filter(r => r.checkedIn).length
    return {
      eventId:    e.id,
      title:      e.title,
      emoji:      emojis.find(x => x.id === e.id)?.emoji ?? '📋',
      date:       e.date,
      hostId:     e.hostId ?? '',
      hostName:   hostName(e.hostId ?? null),
      stage:      stageOf(e, now),
      room:       guests.length,
      scanned,
      ratio:      guests.length ? scanned / guests.length : 0,
      checkInRan: checkInRan(room),
      bar:        CHECK_IN_RAN_RATIO,
      unmarked:   missing.map(m => ({
        attendeeId: m.id,
        userId:     m.userId,
        name:       m.user?.name ?? 'a guest',
        warned:     warned.has(m.userId),
        saysCame:   came.has(m.userId),
      })),
      listSent:   listSent.has(reviewSentKey(e.id)),
      opensAt:    attendanceReviewOpensAt(e, tz).toISOString(),
      settlesAt:  attendanceSettlesAt(e, tz).toISOString(),
      endsAt:     eventEndsAt(e, tz).toISOString(),
    }
  })
  return { rows, total }
}

/** The door keys for an event — who physically ran check-in. Used by the admin view. */
export async function doorRunners(eventId: string): Promise<string[]> {
  const prefix = doorKey(eventId, '')
  const rows = await prisma.rateLimit.findMany({ where: { key: { startsWith: prefix } }, select: { key: true } })
  return rows.map(r => r.key.slice(prefix.length))
}

/**
 * How many rooms are in their review day right now with somebody still
 * unmarked — the number an admin wants on the dashboard, because after
 * tonight those seats settle and the easy fix is gone.
 *
 * Reuses the batched builder rather than growing a second, subtly different
 * definition of "needs attention".
 */
export async function countRoomsNeedingReview(
  now: Date = new Date(), eventIds?: string[], cityId?: string,
): Promise<number> {
  const { rows } = await attendanceReviewRows(now, eventIds, cityId)
  return rows.filter(r => r.stage === 'review' && r.unmarked.length > 0).length
}
