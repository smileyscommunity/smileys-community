import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/cup/watch-parties
//
// Returns upcoming Smileys events tagged as World Cup watch
// parties — published, in the tournament window (Jun 11 → Jul 19
// 2026), filtered by the `vibes` array. Admins tag events with
// "World Cup" (case-insensitive match) to surface them on /cup.
//
// Public read. Limited to the next 6 events to keep the page
// compact; "see all" can deep-link to /events filtered by the
// same tag.

export const dynamic = 'force-dynamic'

const TOURNAMENT_START = '2026-06-01'  // include "lead-up" events too
const TOURNAMENT_END   = '2026-07-19'

export async function GET() {
  // `vibes` is a Postgres text[] — `hasSome` matches if any of the
  // listed strings is present. Case-sensitive in Prisma's typed API,
  // so we cast both spellings admins may use ("World Cup",
  // "World Cup 2026").
  const events = await prisma.event.findMany({
    where: {
      status: 'published',
      date:   { gte: TOURNAMENT_START, lte: TOURNAMENT_END },
      vibes:  { hasSome: ['World Cup', 'World Cup 2026'] },
    },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
    take: 6,
    select: {
      id: true, title: true, emoji: true, date: true, time: true,
      neighborhood: true, location: true, coverImage: true,
      totalSpots: true, spotsLeft: true,
      _count: { select: { attendees: { where: { status: 'approved' } } } },
    },
  })

  return NextResponse.json({ events })
}
