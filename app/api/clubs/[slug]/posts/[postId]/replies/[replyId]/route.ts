import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string; postId: string; replyId: string }> }

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (!await rateLimit(`reply-delete:${session.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many deletions' }, { status: 429 })
  }

  const { replyId } = await params

  const reply = await prisma.clubPostReply.findUnique({
    where: { id: replyId },
    select: { userId: true, post: { select: { clubId: true } } },
  })
  if (!reply) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwn  = reply.userId === session.id

  if (!isOwn && !isAdminOrModerator(session)) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: reply.post.clubId } },
      select: { role: true, status: true },
    })
    if (membership?.role !== 'host' || membership.status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  await prisma.clubPostReply.delete({ where: { id: replyId } })
  return NextResponse.json({ ok: true })
}
