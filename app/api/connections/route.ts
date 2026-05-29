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

  const [sent, received] = await Promise.all([
    prisma.memberConnection.findMany({
      where: { requesterId: session.id },
      include: { receiver: { select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true } } },
    }),
    prisma.memberConnection.findMany({
      where: { receiverId: session.id },
      include: { requester: { select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true } } },
    }),
  ])

  return NextResponse.json({ sent, received })
}

// POST /api/connections — send a connection request
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Layered limits: 5/min stops burst-spam; 20/day stops sustained
  // "scrape every member and request a connection" campaigns that the
  // per-minute cap would otherwise allow over the course of a few hours.
  if (!await rateLimit(`connect:${session.id}`,     5,  60_000))            return NextResponse.json({ error: 'Sending too fast — slow down' }, { status: 429 })
  if (!await rateLimit(`connect-day:${session.id}`, 20, 24 * 60 * 60_000))  return NextResponse.json({ error: 'Daily connection-request cap reached. Try tomorrow.' }, { status: 429 })

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

  // Unordered pair key — guards against the A->B / B->A race at the DB level.
  const pairKey = session.id < receiverId
    ? `${session.id}|${receiverId}`
    : `${receiverId}|${session.id}`

  // Fast path: return existing connection without attempting insert.
  const existing = await prisma.memberConnection.findUnique({ where: { pairKey } })
  if (existing) {
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
