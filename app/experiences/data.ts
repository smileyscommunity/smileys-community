import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { nowInTz } from '@/lib/cityTime'
import { getCityTz } from '@/lib/city'
import { buildShelves, experienceWindow } from '@/lib/experiences'

// The one read behind both /experiences (viewer's city, ?city= aware) and
// /[city]/experiences (fixed city, crawlable). Shared across every visitor
// and cached per city — nothing session-dependent may land in here.
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
  price: true, memberPrice: true, currency: true,
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
    // `events` is the flat, de-duplicated list for structured data — an event
    // on three shelves is still one thing happening.
    return { shelves: buildShelves(events), events }
  },
  ['experiences-page-data'],
  { revalidate: 120, tags: ['experiences'] },
)

export type ExperiencesData = Awaited<ReturnType<typeof getExperiencesData>>
