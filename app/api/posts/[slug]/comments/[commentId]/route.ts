import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePosts, canActOnCityContent } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ slug: string; commentId: string }> }

// Take a comment down: its author, the story's author (their page), or staff
// who can act on the story. Soft (removedAt), so a reported comment stays
// readable to moderation.
export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { slug, commentId } = await params

  const c = await prisma.postComment.findUnique({
    where:  { id: commentId },
    select: { userId: true, removedAt: true, body: true, post: { select: { slug: true, authorId: true, cityId: true } } },
  })
  if (!c || c.post.slug !== slug) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

  const isAuthor = c.userId === session.id
  const isStaff  = canManagePosts(session) && canActOnCityContent(session, c.post.cityId)
  if (!isAuthor && c.post.authorId !== session.id && !isStaff) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (c.removedAt) return NextResponse.json({ ok: true })

  await prisma.postComment.update({ where: { id: commentId }, data: { removedAt: new Date() } })
  if (!isAuthor && isStaff) {
    writeAudit(session.id, session.name, 'post.comment_remove', commentId, 'post_comment',
      { slug, userId: c.userId }, `Removed a story comment: "${c.body.slice(0, 80)}"`)
  }
  return NextResponse.json({ ok: true })
}
