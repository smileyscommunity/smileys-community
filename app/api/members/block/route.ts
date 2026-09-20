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

  const { userId } = await req.json().catch(() => ({}))
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
    // Sever the live connection (both directions). An accepted connection
    // that survived a block kept the blocked person in the blocker's hangout
    // fan-out and in both connection lists; a pending one could even be
    // accepted post-block.
    //
    // A DECLINED row is not severed — it is the decline itself. Those rows
    // are permanent and invisible on purpose (see api/connections): they are
    // what stops someone re-sending a request that was already refused, and
    // what the connection-abuse scan counts. Deleting them meant block →
    // unblock → request again landed a fresh notification, repeatable daily,
    // and scrubbed the sender's volume out of Monday's report.
    prisma.memberConnection.deleteMany({
      where: {
        status: { in: ['pending', 'accepted'] },
        OR: [
          { requesterId: session.id, receiverId: userId },
          { requesterId: userId,     receiverId: session.id },
        ],
      },
    }),
    // A save is a relationship too: blocking someone shouldn't leave them
    // bookmarked (and the saved list filters them out anyway, which made the
    // saved count disagree with it).
    prisma.memberSave.deleteMany({
      where: { OR: [
        { userId: session.id, savedId: userId },
        { userId,             savedId: session.id },
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

  const { userId } = await req.json().catch(() => ({}))
  if (!userId || typeof userId !== 'string') return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  // Blocking is bounded; unblocking wasn't, and the pair of them is how a
  // refused request could be re-sent.
  if (!await rateLimit(`unblock:${session.id}`, 20, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  await prisma.memberBlock.deleteMany({
    where: { blockerId: session.id, blockedId: userId },
  })
  return NextResponse.json({ ok: true })
}
