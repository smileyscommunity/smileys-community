import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateComments, cleanCommentBody } from '@/lib/storyComments'
import { rateLimit } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ slug: string; commentId: string }> }

// Edit your own comment. Author only (staff remove, they don't reword), and
// only while it is up. No new mention notices: editing can't be used to ping.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await rateLimit(`post-comment-edit:${session.id}`, 10, 60_000)) return NextResponse.json({ error: 'Slow down' }, { status: 429 })
  const { slug, commentId } = await params

  const c = await prisma.postComment.findUnique({
    where:  { id: commentId },
    select: { userId: true, removedAt: true, post: { select: { slug: true, status: true, commentsOff: true } } },
  })
  if (!c || c.removedAt || c.post.slug !== slug || c.post.status !== 'published' || c.post.commentsOff) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }
  if (c.userId !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const clean = cleanCommentBody((await req.json().catch(() => ({})))?.body)
  if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 })
  const updated = await prisma.postComment.update({
    where: { id: commentId }, data: { body: clean.body, editedAt: new Date() }, select: { body: true, editedAt: true },
  })
  return NextResponse.json(updated)
}

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
  const isStaff  = canModerateComments(session, c.post.cityId)
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
