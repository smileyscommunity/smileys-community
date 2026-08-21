import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

// GET — list blocked user IDs for current user
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocks = await prisma.memberBlock.findMany({
    where: { blockerId: session.id },
    select: { blockedId: true, createdAt: true, blocked: { select: { id: true, name: true, color: true, profilePhoto: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(blocks)
}

// POST — block a user
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await rateLimit(`block:${session.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { userId } = await req.json()
  if (!userId || typeof userId !== 'string' || userId === session.id) {
    return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  }
  // Validate the target exists first — a garbage id used to hit the FK
  // constraint and 500.
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.$transaction([
    prisma.memberBlock.upsert({
      where: { blockerId_blockedId: { blockerId: session.id, blockedId: userId } },
      create: { blockerId: session.id, blockedId: userId },
      update: {},
    }),
    // Sever the connection (any status, both directions) in the same stroke.
    // An accepted connection that survived a block kept the blocked person
    // in the blocker's hangout fan-out and in both connection lists; a
    // pending one could even be accepted post-block. Re-requests after an
    // unblock stay controlled: the connections POST refuses blocked pairs
    // while the block stands.
    prisma.memberConnection.deleteMany({
      where: { OR: [
        { requesterId: session.id, receiverId: userId },
        { requesterId: userId,     receiverId: session.id },
      ] },
    }),
    // Unseat the pair from each other's live hangouts too — a pre-block
    // joiner would otherwise stay in the party and keep getting its chat.
    prisma.hangoutJoin.deleteMany({
      where: { OR: [
        { userId,             hangout: { userId: session.id, status: 'active' } },
        { userId: session.id, hangout: { userId,             status: 'active' } },
      ] },
    }),
  ])
  return NextResponse.json({ ok: true })
}

// DELETE — unblock a user
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  await prisma.memberBlock.deleteMany({
    where: { blockerId: session.id, blockedId: userId },
  })
  return NextResponse.json({ ok: true })
}
