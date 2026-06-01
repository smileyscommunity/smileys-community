import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageClubs } from '@/lib/access'

// GET /api/admin/hosts
//
// Aggregated list of every approved club host across the platform,
// with their clubs + activity stats baked in. Replaces the old
// /admin/hosts page's client-side fan-out (which fired one
// memberships fetch per club — N+1 against /api/admin/clubs/[id]/
// memberships) with a single server-side query.
//
// Activity metrics:
//   - eventCount: every event this user has ever hosted
//   - eventCount90d: events hosted in the last 90 days. The
//     primary "active vs inactive" signal for the page's filter.
//   - totalAttendees: sum of attendee counts across all hosted
//     events
//   - lastEventAt: most recent event's startsAt (null if never)
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
  lastEventAt:     string | null
}

export async function GET() {
  const session = await getSession()
  if (!session || !canManageClubs(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // One query for memberships, one for events. The events query
  // includes a per-row _count.attendees so we don't need a third
  // aggregation pass against Attendee.
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
  const ninetyDaysAgo  = new Date(Date.now() - NINETY_DAYS_MS)

  const memberships = await prisma.clubMembership.findMany({
    where:  { role: 'host', status: 'approved' },
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
        lastEventAt:    null,
      }
      byUser.set(m.userId, entry)
    }
    entry.clubs.push(m.club)
  }

  const userIds = Array.from(byUser.keys())
  if (userIds.length > 0) {
    // Event stores date as 'YYYY-MM-DD' (String) and time as
    // 'HH:MM' (String) rather than a Date — keep them both and
    // combine in JS to get a comparable timestamp.
    const events = await prisma.event.findMany({
      where:  { hostId: { in: userIds } },
      select: {
        hostId: true,
        date:   true,
        time:   true,
        _count: { select: { attendees: true } },
      },
    })

    for (const e of events) {
      if (!e.hostId) continue
      const h = byUser.get(e.hostId)
      if (!h) continue
      h.eventCount     += 1
      h.totalAttendees += e._count.attendees
      const iso = e.date ? new Date(`${e.date}T${e.time || '00:00'}:00`) : null
      const startMs = iso && !Number.isNaN(iso.getTime()) ? iso.getTime() : null
      if (startMs !== null && startMs >= ninetyDaysAgo.getTime()) h.eventCount90d += 1
      if (startMs !== null && (!h.lastEventAt || new Date(h.lastEventAt).getTime() < startMs)) {
        h.lastEventAt = new Date(startMs).toISOString()
      }
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
