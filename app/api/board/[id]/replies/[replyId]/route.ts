import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canActInCity } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string; replyId: string }> }

// Take a reply down: its author, the post's author (their thread), or staff
// of the post's city. Replies had no way down at all — a harassing one, or
// one carrying someone's number, stayed until its author was banned. Soft
// (removedAt), so a reported reply stays readable to moderation.
export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, replyId } = await params

  const reply = await prisma.boardReply.findUnique({
    where:  { id: replyId },
    select: { postId: true, userId: true, removedAt: true, body: true, post: { select: { userId: true, cityId: true } } },
  })
  if (!reply || reply.postId !== id) return NextResponse.json({ error: 'Reply not found' }, { status: 404 })
  const isAuthor = reply.userId === session.id
  const isStaff  = canActInCity(session, reply.post.cityId)
  if (!isAuthor && reply.post.userId !== session.id && !isStaff) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (reply.removedAt) return NextResponse.json({ ok: true })

  await prisma.boardReply.update({ where: { id: replyId }, data: { removedAt: new Date() } })
  if (!isAuthor && isStaff) {
    writeAudit(session.id, session.name, 'board.reply_remove', replyId, 'board_reply',
      { postId: id, userId: reply.userId }, `Removed a board reply: "${reply.body.slice(0, 80)}"`)
  }
  return NextResponse.json({ ok: true })
}
