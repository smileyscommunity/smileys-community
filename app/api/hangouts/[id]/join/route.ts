import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
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
    select: { id: true, userId: true, title: true, status: true, endsAt: true, maxPeople: true },
  })
  if (!hangout) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (hangout.status !== 'active' || hangout.endsAt < new Date()) {
    return NextResponse.json({ error: 'Hangout already ended' }, { status: 400 })
  }
  if (hangout.userId === session.id) {
    return NextResponse.json({ error: 'You are the host' }, { status: 400 })
  }

  // A block in either direction closes this surface: joining would fire a
  // notification across the blocked pair and seat them in the same party.
  // Same 404 shape as a missing hangout so nothing is probed.
  const blocked = await prisma.memberBlock.findFirst({
    where: { OR: [
      { blockerId: hangout.userId, blockedId: session.id },
      { blockerId: session.id,     blockedId: hangout.userId },
    ] },
    select: { id: true },
  })
  if (blocked) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existing = await prisma.hangoutJoin.findUnique({
    where: { hangoutId_userId: { hangoutId, userId: session.id } },
  })
  if (existing) {
    await prisma.hangoutJoin.delete({ where: { id: existing.id } })
    return NextResponse.json({ joined: false })
  }

  // Capacity check + create under SERIALIZABLE isolation — a plain
  // interactive transaction runs at Read Committed, where two simultaneous
  // joins both count N-1 and both insert (the old comment claimed the tx
  // alone prevented that; it doesn't). Serializable makes one of them fail
  // with P2034, which we retry: on retry it either sees the other join and
  // reports full, or takes a genuinely free spot. maxPeople includes the
  // host, so joiners are capped at maxPeople - 1.
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await prisma.$transaction(async tx => {
          if (hangout.maxPeople) {
            const count = await tx.hangoutJoin.count({ where: { hangoutId } })
            if (count >= hangout.maxPeople - 1) throw new Error('HANGOUT_FULL')
          }
          await tx.hangoutJoin.create({ data: { hangoutId, userId: session.id } })
        }, { isolationLevel: 'Serializable' })
        break
      } catch (e) {
        const retriable = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034'
        if (!retriable || attempt >= 2) throw e
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'HANGOUT_FULL') {
      return NextResponse.json({ error: 'This hangout is full' }, { status: 400 })
    }
    throw e
  }

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
