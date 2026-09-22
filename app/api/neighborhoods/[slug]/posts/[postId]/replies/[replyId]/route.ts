import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canActInCity } from '@/lib/access'

type Params = { params: Promise<{ slug: string; postId: string; replyId: string }> }

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { postId, replyId } = await params
  const reply = await prisma.neighborhoodPostReply.findUnique({ where: { id: replyId }, select: { userId: true, postId: true, post: { select: { cityId: true } } } })
  // The reply has to belong to the post named in the URL. The lookup went by
  // replyId alone, so any postId at all reached any reply; authorization was
  // still right (it reads the reply's OWN post's city), but the route acted on
  // something its URL didn't describe, and the wall removes the reply from
  // whichever post the client addressed.
  if (!reply || reply.postId !== postId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (reply.userId !== session.id && !canActInCity(session, reply.post.cityId)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  await prisma.neighborhoodPostReply.delete({ where: { id: replyId } })
  return NextResponse.json({ ok: true })
}
