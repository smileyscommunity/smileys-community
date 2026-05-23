import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'

async function canManage(session: { id: string; role: string } | null, eventId: string) {
  if (!session) return false
  if (session.role === 'admin') return true
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { hostId: true } })
  return event?.hostId === session.id
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  const { id } = await params
  if (!await canManage(session, id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const cohosts = await prisma.eventCoHost.findMany({
    where: { eventId: id },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
    orderBy: { addedAt: 'asc' },
  })
  return NextResponse.json(cohosts)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  const { id } = await params
  if (!await canManage(session, id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const event = await prisma.event.findUnique({ where: { id }, select: { title: true, hostId: true } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  if (event.hostId === userId) return NextResponse.json({ error: 'Already the main host' }, { status: 400 })

  const cohost = await prisma.eventCoHost.upsert({
    where: { eventId_userId: { eventId: id, userId } },
    create: { eventId: id, userId },
    update: {},
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })

  await createNotification(
    userId,
    'host_assigned',
    `You've been added as co-host`,
    `You've been added as a co-host for "${event.title}".`,
    `/events/${id}`,
  )

  return NextResponse.json(cohost)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  const { id } = await params
  if (!await canManage(session, id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await req.json()
  await prisma.eventCoHost.deleteMany({ where: { eventId: id, userId } })
  return NextResponse.json({ ok: true })
}
