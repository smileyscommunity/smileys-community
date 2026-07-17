import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'
import { trackServer } from '@/lib/posthog-server'

// GET /api/connections — returns my connections and pending requests
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Declined rows are kept in the DB as decline-memory (they permanently
  // block re-request notifications) but are invisible to both sides: the
  // requester sees the request quietly disappear (same UX as the old
  // delete-on-decline), the receiver already handled it.
  const [sent, received] = await Promise.all([
    prisma.memberConnection.findMany({
      where: { requesterId: session.id, status: { not: 'declined' } },
      include: { receiver: { select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true } } },
    }),
    prisma.memberConnection.findMany({
      where: { receiverId: session.id, status: { not: 'declined' } },
      include: { requester: { select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true } } },
    }),
  ])

  return NextResponse.json({ sent, received })
}

// POST /api/connections — send a connection request
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Layered limits: 5/min stops burst-spam; 10/day stops sustained
  // "scrape every member and request a connection" campaigns that the
  // per-minute cap would otherwise allow over the course of a few hours.
  if (!await rateLimit(`connect:${session.id}`,     5,  60_000))            return NextResponse.json({ error: 'Sending too fast — slow down' }, { status: 429 })
  if (!await rateLimit(`connect-day:${session.id}`, 10, 24 * 60 * 60_000))  return NextResponse.json({ error: 'Daily connection-request cap reached. Try tomorrow.' }, { status: 429 })

  // Outstanding-request cap: you can't fan out endlessly — unanswered
  // requests (pending) and recent quiet declines both hold a slot, so
  // mass-requesting stalls out until people actually accept. Withdrawing
  // a genuine pending request frees its slot; a decline holds one for 60
  // days (long enough to starve a spree, short enough that ordinary
  // members are never permanently locked out by invisible declines).
  const declineWindow = new Date(Date.now() - 60 * 24 * 60 * 60_000)
  const outstanding = await prisma.memberConnection.count({
    where: {
      requesterId: session.id,
      OR: [
        { status: 'pending' },
        { status: 'declined', updatedAt: { gte: declineWindow } },
      ],
    },
  })
  if (outstanding >= 10) {
    return NextResponse.json({ error: 'You have too many unanswered requests. Wait for replies before sending more.' }, { status: 429 })
  }

  const { receiverId, note } = await req.json()
  if (!receiverId || receiverId === session.id) {
    return NextResponse.json({ error: 'Invalid receiver' }, { status: 400 })
  }

  const receiver = await prisma.user.findUnique({
    where: { id: receiverId },
    select: { id: true, name: true, status: true },
  })
  if (!receiver || receiver.status !== 'approved') {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // A block in either direction kills the request. Same response as a
  // missing user so the sender can't probe who blocked them.
  const block = await prisma.memberBlock.findFirst({
    where: { OR: [
      { blockerId: receiverId,  blockedId: session.id },
      { blockerId: session.id,  blockedId: receiverId },
    ] },
    select: { id: true },
  })
  if (block) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Unordered pair key — guards against the A->B / B->A race at the DB level.
  const pairKey = session.id < receiverId
    ? `${session.id}|${receiverId}`
    : `${receiverId}|${session.id}`

  // Fast path: return existing connection without attempting insert.
  const existing = await prisma.memberConnection.findUnique({ where: { pairKey } })
  if (existing) {
    if (existing.status === 'declined') {
      if (existing.receiverId === session.id) {
        // The person who declined is re-initiating — a genuine change of
        // heart. Flip the row into a fresh pending request the other way.
        const flipped = await prisma.memberConnection.update({
          where: { id: existing.id },
          data:  { requesterId: session.id, receiverId, status: 'pending', note: note?.trim() || null },
        })
        await createNotification(
          receiverId,
          'connection_request',
          `${session.name} wants to connect`,
          `${session.name} sent you a connection request.`,
          '/members',
        )
        trackServer(session, 'connection_request_sent', {
          receiver_id: receiverId,
          has_note: !!(note?.trim()),
        })
        return NextResponse.json({ connection: flipped })
      }
      // Original requester asking again after a decline: pretend it went
      // through (masked as pending) but write nothing and notify no one.
      // The decline is permanent and invisible.
      return NextResponse.json({ connection: { ...existing, status: 'pending' } })
    }
    return NextResponse.json({ connection: existing })
  }

  let connection
  try {
    connection = await prisma.memberConnection.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { requesterId: session.id, receiverId, pairKey, note: note?.trim() || null } as any,
    })
  } catch (e: unknown) {
    // P2002 = unique-constraint violation — concurrent request won the race.
    if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002') {
      const winner = await prisma.memberConnection.findUnique({ where: { pairKey } })
      if (winner) return NextResponse.json({ connection: winner })
    }
    throw e
  }

  await createNotification(
    receiverId,
    'connection_request',
    `${session.name} wants to connect`,
    `${session.name} sent you a connection request.`,
    '/members',
  )

  trackServer(session, 'connection_request_sent', {
    receiver_id: receiverId,
    has_note: !!(note?.trim()),
  })

  return NextResponse.json({ connection })
}
