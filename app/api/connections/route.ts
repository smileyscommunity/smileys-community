import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'

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

  if (!await rateLimit(`connect:${session.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
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

  // Check for existing connection in either direction
  const existing = await prisma.memberConnection.findFirst({
    where: {
      OR: [
        { requesterId: session.id, receiverId },
        { requesterId: receiverId, receiverId: session.id },
      ],
    },
  })
  if (existing) {
    return NextResponse.json({ connection: existing })
  }

  const connection = await prisma.memberConnection.create({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { requesterId: session.id, receiverId, note: note?.trim() || null } as any,
  })

  await createNotification(
    receiverId,
    'connection_request',
    `${session.name} wants to connect`,
    `${session.name} sent you a connection request.`,
    '/members',
  )

  return NextResponse.json({ connection })
}
