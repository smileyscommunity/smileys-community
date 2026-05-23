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
  if (!userId || userId === session.id) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  await prisma.memberBlock.upsert({
    where: { blockerId_blockedId: { blockerId: session.id, blockedId: userId } },
    create: { blockerId: session.id, blockedId: userId },
    update: {},
  })
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
