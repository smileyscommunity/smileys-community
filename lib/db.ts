import { prisma } from './prisma'
import type { Club, Event, VibeTag } from './data'
import { todayIstanbul } from './data'

// ── Clubs ─────────────────────────────────────────────────────────────────

export async function getClubs(): Promise<Club[]> {
  const today = todayIstanbul()
  const rows = await prisma.club.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { memberships: { where: { status: 'approved' } } } },
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
    memberCount: r._count.memberships,
    nextEvent:   r.events[0] ?? null,
  })) as unknown as Club[]
}

export async function getClubBySlug(slug: string): Promise<Club | undefined> {
  const row = await prisma.club.findUnique({ where: { slug } })
  return row ? (row as Club) : undefined
}

// ── Events ────────────────────────────────────────────────────────────────

export async function getAvailableSpots(eventId: string, totalSpots: number): Promise<number> {
  const approved = await prisma.eventAttendee.count({
    where: { eventId, status: 'approved' },
  })
  return Math.max(0, totalSpots - approved)
}

const eventInclude = {
  club: true,
  _count: { select: { attendees: { where: { status: 'approved' as const } } } },
  tags: { include: { tag: { include: { group: true } } } },
  attendees: {
    where: { status: 'approved' as const },
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
    totalSpots:   e.totalSpots,
    spotsLeft:    spotsLeft ?? e._count?.attendees != null
      ? Math.max(0, e.totalSpots - (e._count?.attendees ?? 0))
      : e.spotsLeft,
    limitedSpots: e.limitedSpots,
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
    turkishMaleQuota: e.turkishMaleQuota ?? null,
    isRecurring:      e.isRecurring ?? false,
    seriesId:         e.seriesId    ?? null,
    hostId:           e.hostId,
    hostName:         '',
    hostColor:        undefined,
    hostPhoto:        null,
    clubId:           e.clubId,
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
  const today = new Date(new Date().toLocaleString('en-CA', { timeZone: 'Europe/Istanbul' }).split(',')[0]).toISOString().split('T')[0]
  const baseWhere = upcoming === true
    ? { date: { gte: today }, status: 'published' }
    : upcoming === false
    ? { date: { lt: today }, status: { in: ['published', 'archived'] } }
    : {}
  const where = cityId ? { ...baseWhere, cityId } : baseWhere

  const [rows, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include: eventInclude,
      orderBy: upcoming === false
        ? [{ date: 'desc' }]
        : [{ featured: 'desc' }, { date: 'asc' }],
      take: limit,
      skip: offset,
    }),
    prisma.event.count({ where }),
  ])

  const events = await enrichHosts(rows.map(e => mapEvent(e)))
  return { events, total }
}

export async function getEventById(id: string): Promise<Event | undefined> {
  const row = await prisma.event.findUnique({
    where: { id },
    include: eventInclude,
  })
  if (!row) return undefined
  const [enriched] = await enrichHosts([mapEvent(row)])
  return enriched
}

export async function getEventsByClub(clubId: string): Promise<Event[]> {
  const today = todayIstanbul()

  // Free events are only shown within 7 days of their date.
  // Paid events are always visible regardless of how far ahead they are.
  const oneWeekAhead = todayIstanbul(7)

  const rows = await prisma.event.findMany({
    where: {
      clubId,
      status: 'published',
      date: { gte: today },
      OR: [
        { price: { gt: 0 } },
        { price: 0, date: { lte: oneWeekAhead } },
      ],
    },
    include: eventInclude,
    orderBy: { date: 'asc' },
  })
  return enrichHosts(rows.map(e => mapEvent(e)))
}
