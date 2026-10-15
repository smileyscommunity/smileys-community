import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

// Toggle a like on a story comment. Members only; the response carries the
// fresh count. Same race handling as the article like.
type Params = { params: Promise<{ slug: string; commentId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (!await rateLimit(`post-comment-like:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { slug, commentId } = await params
  const c = await prisma.postComment.findUnique({
    where:  { id: commentId },
    select: { id: true, removedAt: true, post: { select: { slug: true, status: true, commentsOff: true } } },
  })
  if (!c || c.removedAt || c.post.slug !== slug || c.post.status !== 'published' || c.post.commentsOff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const existing = await prisma.postCommentLike.findUnique({ where: { commentId_userId: { commentId, userId: session.id } } })
  let liked = !existing
  if (existing) {
    const gone = await prisma.postCommentLike.deleteMany({ where: { commentId, userId: session.id } })
    if (gone.count === 0) liked = false
  } else {
    try {
      await prisma.postCommentLike.create({ data: { commentId, userId: session.id } })
    } catch (e) {
      if ((e as { code?: string })?.code !== 'P2002') throw e
      liked = true
    }
  }
  const count = await prisma.postCommentLike.count({ where: { commentId } })
  return NextResponse.json({ liked, count })
}
