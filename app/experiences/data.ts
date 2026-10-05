import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { nowInTz } from '@/lib/cityTime'
import { getCityTz } from '@/lib/city'
import { buildShelves, experienceWindow } from '@/lib/experiences'
import { redactEventForGuest, projectEventsForMember } from '@/lib/db'
import type { Event } from '@/lib/data'
import { getCityEventsHub } from '@/app/[city]/data'
import type { SessionUser } from '@/lib/session'

// The one read behind both /experiences (viewer's city, ?city= aware) and
// /[city]/experiences (fixed city, crawlable). Shared across every visitor
// and cached per city — nothing session-dependent may land in here; what the
// viewer adds (their own RSVPs) is read per request below.
//
// Public: every field selected is within the guest tier the events feed
// already serves (venue NAME is public; exact address/GPS/links are not
// selected at all — nothing to redact).
//
// Upcoming / cancelled / sold-out rules mirror the events feed — see
// lib/experiences for why each one is there.

const CARD_SELECT = {
  id: true, title: true, emoji: true, date: true, time: true,
  location: true, neighborhood: true, coverImage: true, coverImagePosition: true,
  price: true, memberPrice: true, currency: true, membersOnly: true,
  spotsLeft: true, totalSpots: true, limitedSpots: true, soldOut: true, status: true,
  seriesId: true, isRecurring: true,
  club: { select: { name: true, emoji: true, slug: true } },
  tags: { select: { tag: { select: { name: true, emoji: true, group: { select: { name: true } } } } } },
} as const

export const getExperiencesData = unstable_cache(
  async (cityId: string) => {
    // "Today" and the started-cutoff in the CITY's clock, not the founding
    // city's — Tbilisi's evening is an hour off Istanbul's.
    const { today, cutoffTime } = experienceWindow(nowInTz(await getCityTz(cityId)))
    const events = await prisma.event.findMany({
      where: {
        cityId,
        // Cancelled rides along so the card can say so (the feed does the
        // same); drafts and the rest stay out.
        status: { in: ['published', 'cancelled'] },
        OR: [
          { date: { gt: today } },
          { AND: [{ date: today }, { time: { gte: cutoffTime } }] },
        ],
        tags: { some: { tag: { group: { name: 'Experience' } } } },
      },
      select: CARD_SELECT,
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      take: 80,
    })
    // `events` is the flat list for structured data, in the same order.
    return { shelves: buildShelves(events), events }
  },
  ['experiences-page-data'],
  { revalidate: 120, tags: ['experiences'] },
)

export type ExperiencesData = Awaited<ReturnType<typeof getExperiencesData>>

// What the signed-in viewer adds to the shelves: which of these events they
// already hold a seat at. Per request, outside the cache — one member's
// "You're going" must never be served to the next visitor.
export interface ShelfViewer {
  isMember: boolean
  going:    ReadonlySet<string>
}

export async function shelfViewer(session: SessionUser | null, eventIds: string[]): Promise<ShelfViewer> {
  if (!session || eventIds.length === 0) return { isMember: !!session, going: new Set() }
  const seats = await prisma.eventAttendee.findMany({
    where:  { userId: session.id, eventId: { in: eventIds }, status: 'approved' },
    select: { eventId: true },
  })
  return { isMember: true, going: new Set(seats.map(s => s.eventId)) }
}

// When a city has no experiences on the calendar, the page shows what it
// does have: its next few events, from the same cached rows the city hub
// renders. Guest redaction is per request, as on every public event list.
export const FALLBACK_LIMIT = 6

export async function fallbackEvents(cityId: string, session: SessionUser | null): Promise<Event[]> {
  const { events } = await getCityEventsHub(cityId)
  const next = events.slice(0, FALLBACK_LIMIT)
  return session ? projectEventsForMember(next, session) : next.map(redactEventForGuest)
}
