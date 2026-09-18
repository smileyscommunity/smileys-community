import { prisma } from '@/lib/prisma'
import { standingEvents, roomOf, reviewSentKey, type SweepEvent } from '@/lib/standing'
import {
  attendanceReviewOpensAt, attendanceSettlesAt, checkInRan, unmarkedGuests,
  CHECK_IN_RAN_RATIO, doorKey,
} from '@/lib/standingPolicy'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { eventEndsAt } from '@/lib/eventTime'

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
  email:      string | null
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
 * Every event the standing sweep is holding, newest first, with the numbers
 * the decision actually turns on. `eventIds` narrows it to what a host runs;
 * an admin passes nothing and sees all of them.
 */
export async function attendanceReviewRows(now: Date = new Date(), eventIds?: string[]): Promise<ReviewRow[]> {
  let events = await standingEvents(now)
  if (eventIds) {
    const allowed = new Set(eventIds)
    events = events.filter(e => allowed.has(e.id))
  }
  if (events.length === 0) return []

  const hosts = await prisma.user.findMany({
    where:  { id: { in: [...new Set(events.map(e => e.hostId).filter((h): h is string => !!h))] } },
    select: { id: true, name: true },
  })
  const hostName = (id: string | null) => (id ? hosts.find(h => h.id === id)?.name ?? null : null)

  const emojis = await prisma.event.findMany({
    where:  { id: { in: events.map(e => e.id) } },
    select: { id: true, emoji: true },
  })

  const rows: ReviewRow[] = []
  for (const e of events) {
    const tz    = tzOf(e)
    const room  = await roomOf(e)
    const guests = room.filter(r => !r.exempt)
    const missing = unmarkedGuests(room)

    // Who was actually warned. A claim without a notification row is the
    // silent skip that cost Ahmet Öztekin his warning on 2026-09-16 — so the
    // notification, not the claim, is what counts as "warned" here.
    const warned = new Set((await prisma.notification.findMany({
      where:  { type: 'attendance_check', link: { contains: e.id } },
      select: { userId: true },
    })).map(n => n.userId))
    const saysCame = new Set((await prisma.rateLimit.findMany({
      where:  { key: { startsWith: `attendance-says-came:${e.id}:` } },
      select: { key: true },
    })).map(r => r.key.split(':')[2]))
    const listSent = !!(await prisma.rateLimit.findUnique({ where: { key: reviewSentKey(e.id) }, select: { key: true } }))

    const scanned = guests.filter(r => r.checkedIn).length
    rows.push({
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
        email:      m.user?.email ?? null,
        warned:     warned.has(m.userId),
        saysCame:   saysCame.has(m.userId),
      })),
      listSent,
      opensAt:    attendanceReviewOpensAt(e, tz).toISOString(),
      settlesAt:  attendanceSettlesAt(e, tz).toISOString(),
      endsAt:     eventEndsAt(e, tz).toISOString(),
    })
  }

  // Soonest deadline first: what is about to settle is what still needs a hand.
  return rows.sort((a, b) => Date.parse(a.settlesAt) - Date.parse(b.settlesAt))
}

/** The door keys for an event — who physically ran check-in. Used by the admin view. */
export async function doorRunners(eventId: string): Promise<string[]> {
  const prefix = doorKey(eventId, '')
  const rows = await prisma.rateLimit.findMany({ where: { key: { startsWith: prefix } }, select: { key: true } })
  return rows.map(r => r.key.slice(prefix.length))
}
