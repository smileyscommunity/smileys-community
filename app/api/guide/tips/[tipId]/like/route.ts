import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ tipId: string }> }

// Toggle a ❤️ on a member tip. Member-only; one like per member per tip
// (unique constraint does the bookkeeping).
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`guide-tip-like:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Slow down a little' }, { status: 429 })
  }

  const { tipId } = await params
  const tip = await prisma.guideTip.findUnique({ where: { id: tipId }, select: { id: true } })
  if (!tip) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existing = await prisma.guideTipLike.findUnique({
    where: { tipId_userId: { tipId, userId: session.id } },
  })
  if (existing) {
    await prisma.guideTipLike.delete({ where: { id: existing.id } })
  } else {
    await prisma.guideTipLike.create({ data: { tipId, userId: session.id } })
  }
  const likeCount = await prisma.guideTipLike.count({ where: { tipId } })
  return NextResponse.json({ liked: !existing, likeCount })
}
