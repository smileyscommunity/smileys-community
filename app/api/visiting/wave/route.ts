import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'

// POST /api/visiting/wave — sends a one-tap templated DM to a visitor.
// Visitor posts are an explicit invitation for contact so we bypass the
// normal "must be connected" guard. Rate-limited to 5 waves/day to keep
// it genuine. Idempotent: second wave to the same person is a no-op.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`wave:${session.id}`, 5, 24 * 60 * 60_000)) {
    return NextResponse.json({ error: 'Wave limit reached for today (5/day)' }, { status: 429 })
  }

  const { targetUserId } = await req.json()
  if (!targetUserId || targetUserId === session.id) {
    return NextResponse.json({ error: 'Invalid target' }, { status: 400 })
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, status: true },
  })
  if (!target || target.status !== 'approved') {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Verify an active visitor announcement exists — the wave is only valid
  // in that context. endsOn is stored as YYYY-MM-DD string.
  const today = new Date().toISOString().slice(0, 10)
  const announcement = await prisma.visitorAnnouncement.findFirst({
    where: { userId: targetUserId, status: 'active', endsOn: { gte: today } },
    select: { id: true },
  })
  if (!announcement) {
    return NextResponse.json({ error: 'No active visitor post found' }, { status: 400 })
  }

  const block = await prisma.memberBlock.findFirst({
    where: {
      OR: [
        { blockerId: session.id, blockedId: targetUserId },
        { blockerId: targetUserId, blockedId: session.id },
      ],
    },
    select: { id: true },
  })
  if (block) return NextResponse.json({ error: 'Cannot wave to this user' }, { status: 403 })

  // Idempotent: if we already sent them any DM, treat as already waved.
  const existing = await prisma.directMessage.findFirst({
    where: { fromId: session.id, toId: targetUserId },
    select: { id: true },
  })
  if (existing) return NextResponse.json({ ok: true, alreadySent: true })

  const firstName = target.name.split(' ')[0]
  const text = `Hi ${firstName}! 👋 Saw your visit post — welcome to Istanbul! Happy to share tips or meet up while you're here.`

  await prisma.directMessage.create({
    data: { fromId: session.id, toId: targetUserId, text },
  })

  createNotification(
    targetUserId,
    'message',
    `${session.name} waved hello 👋`,
    text,
    `/messages/${session.id}`,
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}
