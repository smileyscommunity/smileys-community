import { prisma } from './prisma'
import React from 'react'
// React 18's runtime (vitest) has no cache(); Next's server runtime does.
// Identity fallback keeps tests running — memoization is an optimization.
const cache: <T extends (...a: never[]) => unknown>(fn: T) => T =
  (React as unknown as { cache?: typeof cache }).cache ?? ((fn) => fn)
import type { Club, Event, VibeTag } from './data'
import { nowInTz, todayInTz, DEFAULT_TZ } from './cityTime'
import { getCityTz, getCityConfig } from './city'
import { isSoldOut } from '@/lib/soldOut'

// ── Clubs ─────────────────────────────────────────────────────────────────

// cityId is required, not defaulted — every caller must decide whose city
// it's listing (viewer's, or the default city on public surfaces), so a
// second city's clubs can never leak into another grid by omission.
// Global clubs (cityId NULL — Cultures of the World, Language) appear
// alongside a city's local clubs only where City.showGlobalClubs says so.
// They're Istanbul-grown, so Bodrum's launch grid was 32 of them stacked above
// its own three clubs, none with a member within 700km; a new city now starts
// with only its own and opts in once those communities have people there.
export async function getClubs(cityId: string): Promise<Club[]> {
  // "Upcoming" is decided by the city's calendar, not the founding city's.
  const today = todayInTz(await getCityTz(cityId))
  const { showGlobalClubs } = await getCityConfig(cityId)
  // isActive:true is the public-surface gate. Admins deactivate
  // clubs via /admin/clubs (sets isActive=false on the row); those
  // are hidden everywhere a member could discover them — listing,
  // detail page, search, sitemap, dashboard recommendations.
  const rows = await prisma.club.findMany({
    where: { isActive: true, ...(showGlobalClubs ? { OR: [{ cityId }, { cityId: null }] } : { cityId }) },
    orderBy: { name: 'asc' },
    include: {
      // Two counts, because a global club (cityId null) is listed in every
      // city and its total says nothing about the city you're standing in.
      // `memberCount` is scoped to this city — "225 members" on Bodrum's list
      // would promise 225 people nearby when the real answer is none.
      // `globalMemberCount` carries the network-wide figure for the surfaces
      // that want to say "across Smileys".
      _count: { select: { memberships: { where: { status: 'approved' } } } },
      memberships: {
        where:  { status: 'approved', user: { cityId } },
        select: { id: true },
      },
      events: {
        where: { date: { gte: today } },
        orderBy: { date: 'asc' },
        take: 1,
        select: { title: true, date: true },
      },
    },
  })
  return rows.map(r => ({
    ...r,
    // A city-scoped club's two counts are identical, so this only changes what
    // a global club reports — and only outside the city its members are in.
    memberCount:       r.cityId === null ? r.memberships.length : r._count.memberships,
    globalMemberCount: r._count.memberships,
    isGlobal:          r.cityId === null,
    nextEvent:         r.events[0] ?? null,
  })) as unknown as Club[]
}

async function getClubBySlugUncached(slug: string): Promise<Club | undefined> {
  // findFirst (not findUnique) so we can compose the slug match with
  // the isActive gate. Deactivated clubs return undefined → the
  // detail page + public JSON endpoint both 404, matching the
  // "removed from public surfaces" semantics of deactivation.
  // Admin/host surfaces query prisma.club directly and aren't
  // affected.
  const row = await prisma.club.findFirst({ where: { slug, isActive: true } })
  return row ? (row as Club) : undefined
}

// ── Events ────────────────────────────────────────────────────────────────
// (getAvailableSpots was deleted here: its one reference was an unused
// import, and its formula counted host/co-host rows that the canonical
// lib/spotsLeft.expectedSpotsLeft excludes — reviving it would have put
// two disagreeing counts in play.)

const eventInclude = {
  club: true,
  _count: { select: { attendees: { where: { status: 'approved' as const } } } },
  tags: { include: { tag: { include: { group: true } } } },
  attendees: {
    // stealth: the detail page already hides stealth RSVPs; without the
    // same filter here they leaked into card avatar previews. hidden:
    // admin-hidden accounts stay out of every member-facing list.
    where: { status: 'approved' as const, stealth: false, user: { hiddenFromMembers: false } },
    take: 5,
    orderBy: { joinedAt: 'desc' as const },
    select: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  },
}

function mapEvent(e: any, spotsLeft?: number): Event {
  const vibes: VibeTag[] = e.tags?.length
    ? e.tags.map((et: any) => et.tag.name as VibeTag)
    : (e.vibes ?? [])
  return {
    id:           e.id,
    title:        e.title,
    description:  e.description,
    date:         e.date,
    time:         e.time,
    location:     e.location,
    neighborhood: e.neighborhood,
    emoji:        e.emoji,
    price:        e.price,
    memberPrice:  e.memberPrice ?? undefined,
    payTo:        e.payTo ?? 'venue',
    paymentContact: e.paymentContact ?? undefined,
    ticketUrl:    e.ticketUrl ?? undefined,
    totalSpots:   e.totalSpots,
    spotsLeft:    spotsLeft ?? Math.max(0, e.spotsLeft ?? 0),
    limitedSpots: e.limitedSpots,
    soldOut:      e.soldOut ?? false,
    isPremium:    e.isPremium,
    membersOnly:  e.membersOnly,
    tags:         e.tags?.map((et: any) => et.tagId) ?? [],
    vibes,
    coverImage:         e.coverImage         ?? undefined,
    coverImagePosition: e.coverImagePosition ?? 50,
    whatsappUrl:      e.whatsappUrl      ?? undefined,
    meetingUrl:       e.meetingUrl       ?? undefined,
    currency:         e.currency         ?? 'TRY',
    approvalRequired: e.approvalRequired ?? false,
    featured:         e.featured         ?? false,
    genderBalance:    e.genderBalance    ?? false,
    maleQuota:        e.maleQuota        ?? null,
    femaleQuota:      e.femaleQuota      ?? null,
    turkishMaleQuota: e.turkishMaleQuota ?? null,
    isRecurring:      e.isRecurring ?? false,
    isFirstTimerFriendly: e.isFirstTimerFriendly ?? false,
    seriesId:         e.seriesId    ?? null,
    hostId:           e.hostId,
    hostName:         '',
    hostColor:        undefined,
    hostPhoto:        null,
    clubId:           e.clubId,
    cityId:           e.cityId,
    clubName:         e.club?.name ?? '',
    attendeePreviews: e.attendees?.map((a: any) => a.user) ?? [],
    address:          e.address          ?? undefined,
    lat:              e.lat              ?? undefined,
    lng:              e.lng              ?? undefined,
    status:           e.status           ?? 'published',
    endTime:          e.endTime          ?? undefined,
    minAge:           e.minAge           ?? undefined,
    maxAge:           e.maxAge           ?? undefined,
    language:         e.language         ?? undefined,
    refundPolicy:     e.refundPolicy     ?? undefined,
    registrationDeadline: e.registrationDeadline ?? undefined,
    cancelReason:     e.cancelReason     ?? undefined,
  }
}

async function enrichHosts(events: Event[]): Promise<Event[]> {
  const ids = [...new Set(events.map(e => e.hostId).filter(Boolean))]
  if (!ids.length) return events
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, color: true, profilePhoto: true },
  })
  const map = Object.fromEntries(users.map(u => [u.id, u]))
  return events.map(e => ({
    ...e,
    hostName:  map[e.hostId]?.name        ?? '',
    hostColor: map[e.hostId]?.color       ?? undefined,
    hostPhoto: map[e.hostId]?.profilePhoto ?? null,
  }))
}

/**
 * Guest-facing projection of an event for logged-out viewers. The events
 * list + detail are public for SEO/discovery, but the precise venue and
 * who's attending are the payoff of joining — withhold them until login.
 * Mirrors redactListingForGuest in lib/listingsPublic.ts.
 *
 * Keeps: title, date/time, neighbourhood, cover, price, and the "X going"
 * count (which EventCard derives from totalSpots − spotsLeft, not from the
 * previews). Strips: exact street address + GPS, chat/meeting links, and
 * attendee names/photos.
 */
export function redactEventForGuest(event: Event): Event {
  return {
    ...event,
    address:          undefined,
    lat:              null,
    lng:              null,
    meetingUrl:       undefined,
    whatsappUrl:      undefined,
    paymentContact:   undefined,
    attendeePreviews: [],
  }
}

export async function getEvents(options?: {
  limit?: number
  offset?: number
  upcoming?: boolean
  // Filter to events in this city. Caller passes the viewer's cityId
  // for the default "show me my city's events" feed; pass undefined
  // for the cross-city "show all" view a traveller would want.
  cityId?: string
}): Promise<{ events: Event[]; total: number }> {
  const { limit = 24, offset = 0, upcoming, cityId } = options ?? {}
  // "Today" and the started-cutoff are computed in the CITY's timezone:
  // when the feed is scoped to a city we use that city's zone, and the
  // unscoped traveller view falls back to the default city's. Both live
  // cities share Europe/Istanbul today, so this is behavior-neutral —
  // but Athens's evening events must not be cut off on Istanbul's clock.
  const tz = cityId ? await getCityTz(cityId) : DEFAULT_TZ
  const { date: today, minutes: nowMins } = nowInTz(tz)
  // Drop events whose start was > 5h ago — keeps in-progress events
  // visible for a typical event's duration but removes finished ones.
  // If subtracting 5h underflows past midnight, clamp to 00:00 (events
  // that crossed midnight from a previous day are already excluded by
  // the `date >= today` lower bound).
  const cutoffMins  = Math.max(0, nowMins - 300)
  const cutoffTime  = `${String(Math.floor(cutoffMins / 60)).padStart(2, '0')}:${String(cutoffMins % 60).padStart(2, '0')}`

  // Include 'cancelled' so the EventCard banner is reachable — members
  // who heard about an event before it was killed need to see WHY it
  // disappeared from their feed, not silently lose it. The card itself
  // grays out, stamps "Cancelled" across the cover, and disables Join.
  const baseWhere = upcoming === true
    ? {
        // Date.gt today catches future days. Same-day events show
        // only when their start time hasn't already passed beyond
        // the 2-hour grace window above.
        OR: [
          { date: { gt: today } },
          { AND: [{ date: today }, { time: { gte: cutoffTime } }] },
        ],
        status: { in: ['published', 'cancelled'] },
      }
    : upcoming === false
    ? {
        // Exact mirror of the upcoming filter so the two buckets are
        // complementary — every event lands in exactly one. Without the
        // same-day arm, today's already-started events (start > 5h ago)
        // drop out of Upcoming but never reach Past, vanishing entirely
        // until midnight. Past = earlier days, plus today's events whose
        // start time has passed the same 5h cutoff used above.
        OR: [
          { date: { lt: today } },
          { AND: [{ date: today }, { time: { lt: cutoffTime } }] },
        ],
        status: { in: ['published', 'archived', 'cancelled'] },
      }
    // No `upcoming` param → all time, but STILL restrict to publicly-visible
    // statuses. Previously this fell through to `{}` (no status/date filter),
    // so a hand-crafted GET /api/events leaked draft/pending/flagged events.
    : { status: { in: ['published', 'archived', 'cancelled'] } }
  const where = cityId ? { ...baseWhere, cityId } : baseWhere

  // event.findMany must complete first because enrichHosts needs
  // the host ids from the rows. But the count query is independent
  // — run it in parallel with enrichHosts so we collapse two
  // sequential round-trips into one. Saves ~30-50ms per events
  // feed load.
  const rows = await prisma.event.findMany({
    where,
    include: eventInclude,
    orderBy: upcoming === false
      ? [{ date: 'desc' }, { time: 'desc' }]
      : [{ featured: 'desc' }, { date: 'asc' }, { time: 'asc' }],
    take: limit,
    skip: offset,
  })
  // Waitlist counts for the sold-out events on this page — shown on the
  // card's "Join waitlist" CTA as social proof of demand. One grouped
  // query for the page, only when a sold-out event is present at all.
  const soldOutIds = rows.filter(isSoldOut).map(e => e.id)
  const [events, total, waitCounts] = await Promise.all([
    enrichHosts(rows.map(e => mapEvent(e))),
    prisma.event.count({ where }),
    soldOutIds.length
      ? prisma.waitlistEntry.groupBy({ by: ['eventId'], where: { eventId: { in: soldOutIds } }, _count: { _all: true } })
      : Promise.resolve([]),
  ])
  const waitByEvent = new Map(waitCounts.map(w => [w.eventId, w._count._all]))
  for (const e of events) {
    const n = waitByEvent.get(e.id)
    if (n) e.waitlistCount = n
  }
  return { events, total }
}

async function getEventByIdUncached(id: string): Promise<Event | undefined> {
  const row = await prisma.event.findUnique({
    where: { id },
    include: eventInclude,
  })
  if (!row) return undefined
  const [enriched] = await enrichHosts([mapEvent(row)])
  return enriched
}

export async function getEventsByClub(clubId: string): Promise<Event[]> {
  // A club can be global (no city of its own), so fall back to the default
  // zone only when there is genuinely no city to ask.
  const club  = await prisma.club.findUnique({ where: { id: clubId }, select: { cityId: true } })
  const today = todayInTz(club?.cityId ? await getCityTz(club.cityId) : DEFAULT_TZ)

  // Show every upcoming club event, regardless of price or distance.
  // The 7-day cap that lives in the global feed (getEvents) is wrong
  // here: members visit a club page specifically to see what's
  // scheduled next, and recurring clubs (book club, language meetups)
  // routinely sit 3-4 weeks out. Hiding those is hiding the answer
  // the page is supposed to give.
  const rows = await prisma.event.findMany({
    where: {
      clubId,
      status: { in: ['published', 'cancelled'] },
      date: { gte: today },
    },
    include: eventInclude,
    orderBy: { date: 'asc' },
  })
  return enrichHosts(rows.map(e => mapEvent(e)))
}

// Request-scoped memo: generateMetadata and the page body both call this,
// so without cache() every detail page paid the query twice per request.
export const getClubBySlug: typeof getClubBySlugUncached = cache(getClubBySlugUncached)

// Request-scoped memo: generateMetadata and the page body both call this,
// so without cache() every detail page paid the query twice per request.
export const getEventById: typeof getEventByIdUncached = cache(getEventByIdUncached)
