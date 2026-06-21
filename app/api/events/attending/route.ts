import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

const eventSelect = { id: true, title: true, date: true, time: true, neighborhood: true, emoji: true, price: true, coverImage: true, status: true }

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json([])

  const [rows, waitlistRows] = await Promise.all([
    prisma.eventAttendee.findMany({
      where: { userId: session.id, status: { in: ['approved', 'pending'] }, event: { status: { not: 'pending' } } },
      include: { event: { select: eventSelect } },
      orderBy: { joinedAt: 'desc' },
    }),
    prisma.waitlistEntry.findMany({
      where: { userId: session.id },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  // Resolve waitlisted events + queue positions without an N+1. Two
  // queries total (events + all entries on those events) instead of two
  // per waitlist row; position is computed in memory (entries created at
  // or before this one, matching the previous count's `lte` semantics).
  const waitlistEventIds = [...new Set(waitlistRows.map(w => w.eventId))]
  const [waitlistEvents, allEntries] = await Promise.all([
    waitlistEventIds.length
      ? prisma.event.findMany({ where: { id: { in: waitlistEventIds } }, select: eventSelect })
      : Promise.resolve([]),
    waitlistEventIds.length
      ? prisma.waitlistEntry.findMany({ where: { eventId: { in: waitlistEventIds } }, select: { eventId: true, createdAt: true } })
      : Promise.resolve([]),
  ])
  const eventById = new Map(waitlistEvents.map(e => [e.id, e]))

  const waitlistWithPos = waitlistRows.map((w) => {
    const event = eventById.get(w.eventId)
    if (!event || event.status === 'pending') return null
    const position = allEntries.filter(e => e.eventId === w.eventId && e.createdAt <= w.createdAt).length
    return {
      eventId: w.eventId, status: 'waitlisted' as const,
      waitlistPosition: position,
      id: event.id, title: event.title, date: event.date,
      time: event.time, neighborhood: event.neighborhood,
      emoji: event.emoji, price: event.price,
      coverImage: event.coverImage, eventStatus: event.status,
    }
  })

  return NextResponse.json([
    ...rows.map(r => ({
      eventId: r.eventId, status: r.status,
      id: r.event.id, title: r.event.title, date: r.event.date,
      time: r.event.time, neighborhood: r.event.neighborhood,
      emoji: r.event.emoji, price: r.event.price,
      coverImage: r.event.coverImage, eventStatus: r.event.status,
    })),
    ...waitlistWithPos.filter(Boolean),
  ])
}
