import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

type Params = { params: Promise<{ slug: string; postId: string; replyId: string }> }

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { replyId } = await params
  const reply = await prisma.neighborhoodPostReply.findUnique({ where: { id: replyId }, select: { userId: true } })
  if (!reply) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (reply.userId !== session.id && !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  await prisma.neighborhoodPostReply.delete({ where: { id: replyId } })
  return NextResponse.json({ ok: true })
}
