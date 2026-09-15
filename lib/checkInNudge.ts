import { checkInIsCredible } from '@/lib/noShowPolicy'

// ── "Check-in is open" ──────────────────────────────────────────────────────
//
// The 2026-09-15 gate query: 37% of events had any check-in, 15% had most of
// the room. The only prompt a host ever got was the dashboard banner after
// the event (components/CheckInPrompt) — somewhere they have to go looking,
// once the room has already gone home. This is the ping at the moment it
// matters: around the start, to the people running the door, linked straight
// to that event's roster.
//
// Pure selection; the hourly reminders sweep (app/api/admin/cron/reminders)
// sends. That sweep fires at :00, so the window is centred on the start: an
// event at 19:30 is nudged at 19:00, one at 19:45 at 20:00. Never more than
// half an hour from the start, and every start falls in exactly one run.

export const CHECKIN_NUDGE_HALF_WINDOW_MIN = 30

export interface NudgeEvent {
  id:          string
  title:       string
  time:        string
  status:      string
  cancelledAt: Date | null
  hostId:      string | null
  cohosts:     { userId: string }[]
  /** Approved rows only. */
  attendees:   { userId: string; checkedIn: boolean }[]
}

export interface CheckInNudge {
  eventId: string
  userIds: string[]
  title:   string
  body:    string
}

export function checkInNudges<E extends NudgeEvent>(
  events: E[], now: Date, startsAtOf: (e: E) => Date,
): CheckInNudge[] {
  const half = CHECKIN_NUDGE_HALF_WINDOW_MIN * 60 * 1000
  return events.flatMap(e => {
    if (e.status !== 'published' || e.cancelledAt) return []
    // "TBA" has no start to be near — read as midnight it would ping at 00:00.
    if (!/\d/.test(e.time ?? '')) return []
    const start = startsAtOf(e).getTime()
    if (!Number.isFinite(start)) return []
    if (now.getTime() < start - half || now.getTime() >= start + half) return []

    // The room without the people running it — the same room the prompt and
    // the no-show sweep count. Nobody to check in, nothing to nudge; a door
    // that is already half scanned doesn't need telling.
    const staff = new Set([e.hostId, ...e.cohosts.map(c => c.userId)].filter((id): id is string => !!id))
    const room  = e.attendees.filter(a => !staff.has(a.userId))
    if (room.length === 0) return []
    if (checkInIsCredible(room.filter(a => a.checkedIn).length, room.length)) return []

    const n = room.length
    return [{
      eventId: e.id,
      userIds: [...staff],
      title:   'Check-in is open 📋',
      body:    `"${e.title}" starts at ${e.time}. ${n} ${n === 1 ? 'person is' : 'people are'} confirmed — tap each one in as they arrive.`,
    }]
  })
}
