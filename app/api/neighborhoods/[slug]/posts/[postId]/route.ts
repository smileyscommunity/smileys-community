import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

type Params = { params: Promise<{ slug: string; postId: string }> }

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { postId } = await params
  const post = await prisma.neighborhoodPost.findUnique({ where: { id: postId }, select: { userId: true } })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (post.userId !== session.id && !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  await prisma.neighborhoodPost.delete({ where: { id: postId } })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  const { postId } = await params
  const { isPinned } = await req.json()
  const post = await prisma.neighborhoodPost.update({
    where: { id: postId },
    data:  { isPinned: !!isPinned, pinnedAt: isPinned ? new Date() : null },
    select: { id: true, isPinned: true },
  })
  return NextResponse.json(post)
}
