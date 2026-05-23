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

  const waitlistWithPos = await Promise.all(
    waitlistRows.map(async (w) => {
      const [event, position] = await Promise.all([
        prisma.event.findUnique({ where: { id: w.eventId }, select: eventSelect }),
        prisma.waitlistEntry.count({ where: { eventId: w.eventId, createdAt: { lte: w.createdAt } } }),
      ])
      if (!event || event.status === 'pending') return null
      return {
        eventId: w.eventId, status: 'waitlisted' as const,
        waitlistPosition: position,
        id: event.id, title: event.title, date: event.date,
        time: event.time, neighborhood: event.neighborhood,
        emoji: event.emoji, price: event.price,
        coverImage: event.coverImage, eventStatus: event.status,
      }
    })
  )

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
