import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

// Comment thread on a hangout — coordination chat ("running 10min late",
// "we're at the back table"). Host + everyone who tapped "I'm in" gets a
// push on each new message (except the sender).

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: hangoutId } = await params
  const messages = await prisma.hangoutMessage.findMany({
    where:   { hangoutId },
    orderBy: { createdAt: 'asc' },
    take:    200,
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })
  return NextResponse.json({ messages })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`hangout-msg:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Slow down' }, { status: 429 })
  }

  const { id: hangoutId } = await params
  const { body } = await req.json()
  if (typeof body !== 'string' || !body.trim()) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }
  if (body.length > 1000) return NextResponse.json({ error: 'Too long' }, { status: 400 })

  const hangout = await prisma.hangout.findUnique({
    where:  { id: hangoutId },
    select: { id: true, userId: true, title: true, status: true, endsAt: true },
  })
  if (!hangout) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (hangout.status !== 'active' || hangout.endsAt < new Date()) {
    return NextResponse.json({ error: 'Hangout already ended' }, { status: 400 })
  }

  const message = await prisma.hangoutMessage.create({
    data: { hangoutId, userId: session.id, body: body.trim().slice(0, 1000) },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })

  // Notify host + everyone who joined, minus the sender. createNotification
  // writes an inbox row AND fires the push.
  prisma.hangoutJoin.findMany({
    where:  { hangoutId, userId: { not: session.id } },
    select: { userId: true },
  }).then(joins => {
    const recipientIds = new Set(joins.map(j => j.userId))
    if (hangout.userId !== session.id) recipientIds.add(hangout.userId)
    for (const uid of recipientIds) {
      createNotification(
        uid,
        'hangout_message',
        `💬 ${session.name} in "${hangout.title}"`,
        body.trim().slice(0, 120),
        '/hangouts',
      ).catch(() => {})
    }
  }).catch(() => {})

  return NextResponse.json({ message }, { status: 201 })
}
