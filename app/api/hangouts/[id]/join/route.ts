import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'

// Toggle "I'm in" for a hangout. Single endpoint, idempotent: present →
// remove, absent → create. Host doesn't need to join their own hangout
// (they're implicitly in).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: hangoutId } = await params
  const hangout = await prisma.hangout.findUnique({
    where:  { id: hangoutId },
    select: { id: true, userId: true, title: true, status: true, endsAt: true },
  })
  if (!hangout) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (hangout.status !== 'active' || hangout.endsAt < new Date()) {
    return NextResponse.json({ error: 'Hangout already ended' }, { status: 400 })
  }
  if (hangout.userId === session.id) {
    return NextResponse.json({ error: 'You are the host' }, { status: 400 })
  }

  const existing = await prisma.hangoutJoin.findUnique({
    where: { hangoutId_userId: { hangoutId, userId: session.id } },
  })
  if (existing) {
    await prisma.hangoutJoin.delete({ where: { id: existing.id } })
    return NextResponse.json({ joined: false })
  }

  await prisma.hangoutJoin.create({ data: { hangoutId, userId: session.id } })

  // Ping the host — createNotification gives them an inbox row AND a push
  // (so they catch up if they missed the notification).
  createNotification(
    hangout.userId,
    'hangout_join',
    '👋 Someone joined your hangout',
    `${session.name} is in for "${hangout.title}"`,
    '/hangouts',
  ).catch(() => {})

  return NextResponse.json({ joined: true })
}
