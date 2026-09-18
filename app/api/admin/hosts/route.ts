import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageClubs } from '@/lib/access'
import { todayInTz, shiftDay, DEFAULT_TZ } from '@/lib/cityTime'

// GET /api/admin/hosts
//
// Aggregated list of every approved club host across the platform,
// with their clubs + activity stats baked in. Replaces the old
// /admin/hosts page's client-side fan-out (which fired one
// memberships fetch per club — N+1 against /api/admin/clubs/[id]/
// memberships) with a single server-side query.
//
// Who counts as a host: an approved member holding an approved host
// membership of an active club. Banned members and hosts of deactivated
// clubs used to be listed as if they were still running something.
//
// Activity metrics, over events that actually happened — published or
// archived, dated before today in the event's own city. Cancelled, draft
// and future events used to count, so "Last event" could be next month.
//   - eventCount: every such event this user has hosted
//   - eventCount90d: those in the last 90 days. The primary "active vs
//     inactive" signal for the page's filter.
//   - totalAttendees: sum of attendee counts across them
//   - lastEventDate: the most recent one's day, 'YYYY-MM-DD' (null if
//     never). A bare day: event times are free text and an unusual one
//     used to drop the event from every figure here.
//
// Auth: admin only (canManageClubs) — same gate as the
// memberships PATCH endpoint that demote/promote actions hit.

export const dynamic = 'force-dynamic'

export interface AdminHostEntry {
  userId:          string
  user:            { id: string; name: string; email: string; color: string }
  clubs:           { id: string; name: string; emoji: string }[]
  eventCount:      number
  eventCount90d:   number
  totalAttendees:  number
  lastEventDate:   string | null
}

export async function GET() {
  const session = await getSession()
  if (!session || !canManageClubs(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // One query for memberships, one for events. The events query
  // includes a per-row _count.attendees so we don't need a third
  // aggregation pass against Attendee.
  const memberships = await prisma.clubMembership.findMany({
    where:  { role: 'host', status: 'approved', user: { status: 'approved' }, club: { isActive: true } },
    select: {
      userId: true,
      user:   { select: { id: true, name: true, email: true, color: true } },
      club:   { select: { id: true, name: true, emoji: true } },
    },
  })

  // Group memberships into one entry per user.
  const byUser = new Map<string, AdminHostEntry>()
  for (const m of memberships) {
    if (!m.user || !m.club) continue
    let entry = byUser.get(m.userId)
    if (!entry) {
      entry = {
        userId:         m.userId,
        user:           m.user,
        clubs:          [],
        eventCount:     0,
        eventCount90d:  0,
        totalAttendees: 0,
        lastEventDate:  null,
      }
      byUser.set(m.userId, entry)
    }
    entry.clubs.push(m.club)
  }

  const userIds = Array.from(byUser.keys())
  if (userIds.length > 0) {
    // Event.date is a 'YYYY-MM-DD' day in the event's city, so "before
    // today" and "the last 90 days" are string comparisons against that
    // city's today. Tz lookups are memoised — a handful of cities at most.
    const events = await prisma.event.findMany({
      where:  { hostId: { in: userIds }, status: { in: ['published', 'archived'] } },
      select: {
        hostId: true,
        date:   true,
        city:   { select: { timezone: true } },
        _count: { select: { attendees: { where: { status: 'approved' } } } },
      },
    })

    const todayFor = new Map<string, string>()
    const todayIn = (tz: string) => {
      let t = todayFor.get(tz)
      if (t === undefined) { t = todayInTz(tz); todayFor.set(tz, t) }
      return t
    }
    for (const e of events) {
      if (!e.hostId || !/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '')) continue
      const h = byUser.get(e.hostId)
      if (!h) continue
      const today = todayIn(e.city?.timezone ?? DEFAULT_TZ)
      if (e.date >= today) continue
      h.eventCount     += 1
      h.totalAttendees += e._count.attendees
      if (e.date >= shiftDay(today, -90)) h.eventCount90d += 1
      if (!h.lastEventDate || h.lastEventDate < e.date) h.lastEventDate = e.date
    }
  }

  // Sort by recent activity (events in last 90d desc), then by
  // total events as a tiebreaker. Idle hosts sink to the bottom
  // where the admin can spot them for cleanup.
  const hosts = Array.from(byUser.values()).sort((a, b) => {
    if (a.eventCount90d !== b.eventCount90d) return b.eventCount90d - a.eventCount90d
    if (a.eventCount    !== b.eventCount)    return b.eventCount    - a.eventCount
    return a.user.name.localeCompare(b.user.name)
  })

  return NextResponse.json({ hosts })
}
