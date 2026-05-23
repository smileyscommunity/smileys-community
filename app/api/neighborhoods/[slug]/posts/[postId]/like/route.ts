import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

type Params = { params: Promise<{ slug: string; postId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { postId } = await params
  const { emoji = '❤️' } = await req.json()

  const existing = await prisma.neighborhoodPostLike.findUnique({
    where: { postId_userId: { postId, userId: session.id } },
  })

  if (existing) {
    if (existing.emoji === emoji) {
      await prisma.neighborhoodPostLike.delete({ where: { postId_userId: { postId, userId: session.id } } })
    } else {
      await prisma.neighborhoodPostLike.update({
        where: { postId_userId: { postId, userId: session.id } },
        data:  { emoji },
      })
    }
  } else {
    await prisma.neighborhoodPostLike.create({ data: { postId, userId: session.id, emoji } })
  }

  const likes = await prisma.neighborhoodPostLike.findMany({ where: { postId }, select: { userId: true, emoji: true } })
  return NextResponse.json({ likes })
}
