import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { REACTION_EMOJIS } from '@/lib/posts'

type Params = { params: Promise<{ slug: string; postId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { slug, postId } = await params
  const body = await req.json().catch(() => ({}))
  // Allowlist match — same shape as the club like route. Without this a caller
  // could store arbitrary strings (or zero-width chars) as a "reaction".
  const emoji: string = REACTION_EMOJIS.includes(body.emoji) ? body.emoji : '❤️'

  // IDOR fix: scope the post by the slug in the URL.
  const post = await prisma.neighborhoodPost.findUnique({ where: { id: postId }, select: { neighborhood: true } })
  if (!post || post.neighborhood !== slug) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
