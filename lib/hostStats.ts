import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { eventEndsAt } from '@/lib/eventTime'
import { dayInTz, shiftDay, safeTz, DEFAULT_TZ } from '@/lib/cityTime'
import { Attendance, AttendeeStatus } from '@/lib/constants'

// ── What a host's own numbers are allowed to count ──────────────────────────
//
// The host dashboard's impact card and quality panel used to count every
// event the caller had ever put in the system: next month's, the one still
// waiting for approval, the postponed one, the flagged one. "Social Moments"
// was the number of RSVPs, and the would-return rate listed the six events
// furthest in the future as "recent". A host reading those numbers was
// reading their calendar, not what their events had done.
//
// So both read from here: an event counts once it has actually happened —
// published or archived (never cancelled, draft, pending, rejected or
// postponed) and past its end in its own city's clock (eventEndsAt, which
// puts an event with no end time at 23:59 on its date) — and a guest counts
// only if they came.

/** Statuses of an event that went ahead. Cancelled is not one of them. */
export const HELD_EVENT_STATUSES = ['published', 'archived'] as const

// Accounts whose presence we don't credit to anyone. Same pair the push and
// email paths refuse to deliver to.
const GONE_USER_STATUSES = ['banned', 'deleted']

/**
 * An approved seat whose holder came: checked in at the door, or settled as
 * attended afterwards. Same rule as the admin funnel (app/api/admin/stats)
 * and the payment chase — an RSVP to something that happened is not a visit.
 * Banned and deleted accounts drop out.
 */
export const attendedSeatWhere = {
  status: AttendeeStatus.Approved,
  OR:     [{ checkedIn: true }, { attendance: Attendance.Attended }],
  user:   { status: { notIn: GONE_USER_STATUSES } },
} satisfies Prisma.EventAttendeeWhereInput

export interface HeldEvent {
  id:       string
  title:    string
  emoji:    string
  date:     string
  hostId:   string
  staffIds: string[]   // host + co-hosts: they run the room, they aren't guests in it
}

/**
 * The events matching `where` that went ahead and are over, newest first.
 *
 * The status and a coarse date bound are filtered in SQL; "is it over" is
 * decided per event with its own city's timezone, which SQL can't do on a
 * text date. The bound is UTC tomorrow: no city is more than a day ahead of
 * UTC, so an event dated later than that cannot have ended anywhere.
 */
export async function heldEvents(where: Prisma.EventWhereInput, now: Date = new Date()): Promise<HeldEvent[]> {
  const rows = await prisma.event.findMany({
    where:   {
      AND: [
        where,
        { status: { in: [...HELD_EVENT_STATUSES] }, date: { lte: shiftDay(dayInTz(now, 'UTC'), 1) } },
      ],
    },
    select:  {
      id: true, title: true, emoji: true, date: true, time: true, endTime: true, hostId: true,
      cohosts: { select: { userId: true } },
      city:    { select: { timezone: true } },
    },
    orderBy: [{ date: 'desc' }, { time: 'desc' }],
  })
  return rows
    .filter(e => eventEndsAt(e, safeTz(e.city?.timezone ?? DEFAULT_TZ)).getTime() <= now.getTime())
    .map(e => ({
      id: e.id, title: e.title, emoji: e.emoji, date: e.date, hostId: e.hostId,
      staffIds: [e.hostId, ...e.cohosts.map(c => c.userId)],
    }))
}

// ── Survey answers, published in steps ──────────────────────────────────────
//
// The would-return rate is anonymous, and a rate that moves with every single
// answer isn't: a host who notes "83%" before an event and "80%" after it, and
// knows one person filled the survey in, knows what that person said. A
// minimum sample (3+) only protects the first reading, not the difference
// between two readings.
//
// So a rate is only ever computed over a whole number of blocks of
// SURVEY_STEP answers, per event: the earliest floor(n / step) * step answers
// (by when they were given; id breaks ties so the choice is deterministic and
// needs no stored state). The 4th and 5th answers to an event change nothing
// on screen; the 6th moves the rate by a block of three at once. The overall
// figure is built only from those same per-event blocks — never from answers
// an event's own rate still holds back — so subtracting one reading from
// another can't isolate anyone either.
//
// What this can't hide: if all three people in a block answered the same way,
// the block's answer is everyone's. That is the floor any k = 3 threshold has,
// and the same one the per-event minimum always had.

export const SURVEY_STEP = 3

export interface SurveyAnswer {
  id:          string
  eventId:     string
  wouldReturn: boolean
  createdAt:   Date
}

export interface SteppedRate {
  basedOn: number          // how many answers the rate is computed from
  rate:    number | null   // 0–100; null until a full block exists
}

/** Earliest answers first, id as the tie-break. */
function byAnswerTime(a: SurveyAnswer, b: SurveyAnswer): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** The answers a rate may be built from: whole blocks, earliest first. */
export function publishableAnswers(answers: SurveyAnswer[], step: number = SURVEY_STEP): SurveyAnswer[] {
  const n = Math.floor(answers.length / step) * step
  return [...answers].sort(byAnswerTime).slice(0, n)
}

function rateOf(answers: SurveyAnswer[]): SteppedRate {
  if (answers.length === 0) return { basedOn: 0, rate: null }
  const yes = answers.filter(a => a.wouldReturn).length
  return { basedOn: answers.length, rate: Math.round((yes / answers.length) * 100) }
}

/**
 * Stepped would-return rates per event, and overall from the union of the
 * per-event blocks (a response-weighted rate, not an average of averages).
 */
export function steppedWouldReturn(
  answers: SurveyAnswer[],
  step: number = SURVEY_STEP,
): { perEvent: Map<string, SteppedRate>; overall: SteppedRate } {
  const byEvent = new Map<string, SurveyAnswer[]>()
  for (const a of answers) {
    const list = byEvent.get(a.eventId)
    if (list) list.push(a)
    else byEvent.set(a.eventId, [a])
  }
  const perEvent = new Map<string, SteppedRate>()
  const published: SurveyAnswer[] = []
  for (const [eventId, list] of byEvent) {
    const kept = publishableAnswers(list, step)
    perEvent.set(eventId, rateOf(kept))
    published.push(...kept)
  }
  return { perEvent, overall: rateOf(published) }
}
