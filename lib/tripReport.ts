// ── Cross-city trips, phase 4: what each trip achieved ───────────────────────
//
// A trip exists to seed the city it visits (lib/eventTrip): locals meet the
// visitors (phase 2, lib/notify notifyTripArrival) and the visitors join the
// city (phase 3, lib/tripFollowUp). This is the per-trip read-out of whether
// that happened, from data that already exists — no new tables:
//
//   going / went  — approved attendees, and those checked in or marked attended
//   locals        — attendees who already belonged to the destination BEFORE
//                   the trip (home city, or joined it as a second city)
//   alerted       — destination members sent the "coming to <city>" alert
//   invited       — travellers sent the "add <city> to your cities" invite
//   joined        — travellers who added the destination ON OR AFTER the trip day
//
// The two notification counts match on what the senders write (link + title),
// because a notification row has no event column.

import { prisma } from './prisma'

export interface TripRow {
  id:          string
  title:       string
  date:        string
  status:      string
  origin:      string
  destination: string
  destinationSlug: string
  club:        string | null
  going:       number
  went:        number
  locals:      number
  alerted:     number
  invited:     number
  joined:      number
}

export interface TripAttendee {
  userId:     string
  homeCityId: string | null
  checkedIn:  boolean
  attendance: string
  /** When this attendee's 'member' relationship to the destination began, if any. */
  joinedDestinationAt: Date | null
}

/** Pure: the attendee-derived numbers for one trip. `tripDay` is its date at 00:00 UTC. */
export function tripAttendeeStats(destinationId: string, tripDay: Date, attendees: TripAttendee[]) {
  let went = 0, locals = 0, joined = 0
  for (const a of attendees) {
    if (a.checkedIn || a.attendance === 'attended') went++
    const homeHere   = a.homeCityId === destinationId
    const joinedEarly = !!a.joinedDestinationAt && a.joinedDestinationAt < tripDay
    if (homeHere || joinedEarly) locals++
    else if (a.joinedDestinationAt && a.joinedDestinationAt >= tripDay) joined++
  }
  return { going: attendees.length, went, locals, joined }
}

export async function getTripReport(limit = 100): Promise<TripRow[]> {
  const trips = await prisma.event.findMany({
    where:   { originCityId: { not: null } },
    orderBy: [{ date: 'desc' }],
    take:    limit,
    select: {
      id: true, title: true, date: true, status: true, cityId: true,
      city:       { select: { name: true, slug: true } },
      originCity: { select: { name: true } },
      club:       { select: { name: true } },
    },
  })
  if (trips.length === 0) return []

  return Promise.all(trips.map(async t => {
    const tripDay = new Date(`${t.date}T00:00:00Z`)
    const attendees = await prisma.eventAttendee.findMany({
      where:  { eventId: t.id, status: 'approved' },
      select: { userId: true, checkedIn: true, attendance: true, user: { select: { cityId: true } } },
    })
    const userIds = attendees.map(a => a.userId)
    const [relationships, alerted, invited] = await Promise.all([
      userIds.length
        ? prisma.cityRelationship.findMany({ where: { userId: { in: userIds }, cityId: t.cityId, type: 'member' }, select: { userId: true, createdAt: true } })
        : Promise.resolve([] as { userId: string; createdAt: Date }[]),
      prisma.notification.count({ where: { link: `/events/${t.id}`, title: { startsWith: 'Members from ' } } }),
      userIds.length
        ? prisma.notification.count({ where: { userId: { in: userIds }, link: `/${t.city.slug}`, title: `You've been to ${t.city.name} 🚆` } })
        : Promise.resolve(0),
    ])
    const joinedAt = new Map(relationships.map(r => [r.userId, r.createdAt]))
    const stats = tripAttendeeStats(t.cityId, tripDay, attendees.map(a => ({
      userId: a.userId, homeCityId: a.user.cityId, checkedIn: a.checkedIn, attendance: a.attendance,
      joinedDestinationAt: joinedAt.get(a.userId) ?? null,
    })))
    return {
      id: t.id, title: t.title, date: t.date, status: t.status,
      origin: t.originCity?.name ?? '', destination: t.city.name, destinationSlug: t.city.slug,
      club: t.club?.name ?? null,
      ...stats, alerted, invited,
    }
  }))
}
