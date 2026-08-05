import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// My Events hub data (Events brief §36) — the two tabs the existing
// /api/events/attending endpoint doesn't cover: Hosting and Saved.
// Attending/pending/waitlist stay on that endpoint; this one adds to it
// rather than replacing it, so nothing existing has to change.

const CARD_SELECT = {
  id: true, title: true, emoji: true, date: true, time: true,
  location: true, neighborhood: true, coverImage: true,
  status: true, price: true, spotsLeft: true, totalSpots: true, limitedSpots: true,
} as const

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [hosting, cohosting, saves] = await Promise.all([
    // Event.hostId is a bare column (no User back-relation), so hosted
    // events are fetched by id rather than through a relation filter.
    prisma.event.findMany({
      where:   { hostId: session.id, status: { in: ['published', 'draft', 'cancelled'] } },
      select:  CARD_SELECT,
      orderBy: [{ date: 'desc' }],
      take:    50,
    }),
    prisma.eventCoHost.findMany({
      where:  { userId: session.id },
      select: { event: { select: CARD_SELECT } },
      take:   50,
    }),
    prisma.eventSave.findMany({
      where:   { userId: session.id, event: { status: 'published' } },
      select:  { event: { select: CARD_SELECT } },
      orderBy: { createdAt: 'desc' },
      take:    50,
    }),
  ])

  // A co-hosted event shouldn't appear twice if the member also hosts it.
  const hostingIds = new Set(hosting.map(e => e.id))
  const merged = [...hosting, ...cohosting.map(c => c.event).filter(e => !hostingIds.has(e.id))]
    .sort((a, b) => b.date.localeCompare(a.date))

  return NextResponse.json({
    hosting: merged,
    saved:   saves.map(s => s.event),
  })
}
