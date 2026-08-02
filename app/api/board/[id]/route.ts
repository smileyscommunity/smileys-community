import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

type Params = { params: Promise<{ id: string }> }

// Author (or staff) removes a post. Soft delete — status='removed' — so
// moderation can still see what was posted if it was reported first.
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const post = await prisma.boardPost.findUnique({ where: { id }, select: { userId: true } })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  if (post.userId !== session.id && !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.boardPost.update({ where: { id }, data: { status: 'removed' } })
  return NextResponse.json({ ok: true })
}
