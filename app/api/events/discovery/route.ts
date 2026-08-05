import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { groupBySeries, seriesCadenceLabel } from '@/lib/eventSeries'

// Events discovery (Events brief §6–7, §14–18): the personalized
// sections that sit above the general feed. One request serves them all.
//
// Works logged-out too (§56): personalized sections come back empty and
// the caller falls through to Happening Soon / This Weekend.
//
// Every event stays a canonical record (§68) — series grouping is
// display-only, and attendee context is computed, never stored.

const CARD_SELECT = {
  id: true, title: true, emoji: true, date: true, time: true,
  location: true, neighborhood: true, coverImage: true,
  price: true, memberPrice: true, currency: true,
  spotsLeft: true, totalSpots: true, limitedSpots: true,
  seriesId: true, isRecurring: true, status: true,
  club: { select: { id: true, name: true, emoji: true, slug: true } },
} as const

// Istanbul-local day boundaries (UTC+3, no DST) — the same discipline
// the rest of the app uses for date-as-text columns.
function istanbulDays() {
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d)
  const now = new Date()
  const today = fmt(now)
  const tomorrow = fmt(new Date(now.getTime() + 86_400_000))
  // Weekend = the coming Sat+Sun (today counts when we're already in it).
  // Day-of-week comes from the Istanbul date string anchored at local
  // noon — Intl has no numeric weekday, and noon avoids any edge where a
  // UTC-midnight anchor lands on the previous day.
  const dow = new Date(`${today}T12:00:00+03:00`).getUTCDay()
  const daysToSat = (6 - dow + 7) % 7
  const sat = fmt(new Date(now.getTime() + daysToSat * 86_400_000))
  const sun = fmt(new Date(now.getTime() + (daysToSat + 1) * 86_400_000))
  const weekOut = fmt(new Date(now.getTime() + 7 * 86_400_000))
  return { today, tomorrow, sat, sun, weekOut }
}

export async function GET() {
  const session = await getSession()
  const { today, sat, sun, weekOut } = istanbulDays()

  const publishedUpcoming = {
    status: 'published' as const,
    date: { gte: today },
  }

  // Logged-out (§56): weekend + soon only, no personalization.
  if (!session) {
    const [soon, weekend] = await Promise.all([
      prisma.event.findMany({ where: publishedUpcoming, select: CARD_SELECT, orderBy: [{ date: 'asc' }, { time: 'asc' }], take: 24 }),
      prisma.event.findMany({ where: { ...publishedUpcoming, date: { in: [sat, sun] } }, select: CARD_SELECT, orderBy: [{ date: 'asc' }, { time: 'asc' }], take: 12 }),
    ])
    return NextResponse.json({
      going: [], comingUp: [], fromClubs: [], nearYou: [], trySomethingNew: [],
      soon: shapeGroups(soon),
      weekend: shapeGroups(weekend),
      viewer: { isMember: false, neighborhood: null },
    })
  }

  const [me, myClubs, myRsvps] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.id }, select: { neighborhood: true, interests: true } }),
    prisma.clubMembership.findMany({ where: { userId: session.id, status: 'approved' }, select: { clubId: true } }),
    prisma.eventAttendee.findMany({
      where:  { userId: session.id, status: 'approved', event: { ...publishedUpcoming } },
      select: { event: { select: CARD_SELECT } },
    }),
  ])
  const clubIds = myClubs.map(c => c.clubId)
  const rsvpEvents = myRsvps.map(r => r.event).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  const rsvpIds = new Set(rsvpEvents.map(e => e.id))

  const [soon, weekend, fromClubs, nearYou, newToYou] = await Promise.all([
    prisma.event.findMany({ where: publishedUpcoming, select: CARD_SELECT, orderBy: [{ date: 'asc' }, { time: 'asc' }], take: 40 }),
    prisma.event.findMany({ where: { ...publishedUpcoming, date: { in: [sat, sun] } }, select: CARD_SELECT, orderBy: [{ date: 'asc' }, { time: 'asc' }], take: 12 }),
    clubIds.length > 0
      ? prisma.event.findMany({
          where:   { ...publishedUpcoming, clubId: { in: clubIds }, id: { notIn: [...rsvpIds] } },
          select:  CARD_SELECT, orderBy: [{ date: 'asc' }, { time: 'asc' }], take: 12,
        })
      : Promise.resolve([]),
    me?.neighborhood
      ? prisma.event.findMany({
          where:   { ...publishedUpcoming, neighborhood: me.neighborhood, id: { notIn: [...rsvpIds] } },
          select:  CARD_SELECT, orderBy: [{ date: 'asc' }, { time: 'asc' }], take: 8,
        })
      : Promise.resolve([]),
    // §17 — deliberately OUTSIDE the viewer's clubs, so personalization
    // doesn't become a filter bubble.
    prisma.event.findMany({
      where: {
        ...publishedUpcoming,
        id: { notIn: [...rsvpIds] },
        ...(clubIds.length > 0 ? { OR: [{ clubId: null }, { clubId: { notIn: clubIds } }] } : {}),
        date: { gte: today, lte: weekOut },
      },
      select: CARD_SELECT, orderBy: [{ date: 'asc' }, { time: 'asc' }], take: 8,
    }),
  ])

  return NextResponse.json({
    going:     rsvpEvents.slice(0, 1).map(shapeOne),
    comingUp:  rsvpEvents.slice(1, 4).map(shapeOne),
    soon:      shapeGroups(soon),
    weekend:   shapeGroups(weekend),
    fromClubs: shapeGroups(fromClubs),
    nearYou:   shapeGroups(nearYou),
    trySomethingNew: shapeGroups(newToYou).slice(0, 4),
    viewer: { isMember: true, neighborhood: me?.neighborhood ?? null, hasClubs: clubIds.length > 0 },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeOne(e: any) {
  return {
    id: e.id, title: e.title, emoji: e.emoji, date: e.date, time: e.time,
    location: e.location, neighborhood: e.neighborhood, coverImage: e.coverImage,
    price: e.price, memberPrice: e.memberPrice, currency: e.currency,
    spotsLeft: e.spotsLeft, totalSpots: e.totalSpots, limitedSpots: e.limitedSpots,
    club: e.club ?? null,
  }
}

// Collapses series (§38) and annotates the cadence line.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeGroups(events: any[]) {
  return groupBySeries(events).map(g => ({
    ...shapeOne(g.next),
    series: g.isSeries
      ? { count: g.seriesCount, cadence: seriesCadenceLabel(g), moreDates: g.upcoming.slice(0, 3).map(e => e.date) }
      : null,
  }))
}
