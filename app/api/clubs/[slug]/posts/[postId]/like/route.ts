import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string; postId: string }> }

const ALLOWED_EMOJIS = ['❤️', '👍', '🔥', '😂']

function buildReactions(likes: { userId: string; emoji: string }[], sessionId: string) {
  const counts: Record<string, number> = {}
  let myEmoji: string | null = null
  for (const l of likes) {
    counts[l.emoji] = (counts[l.emoji] ?? 0) + 1
    if (l.userId === sessionId) myEmoji = l.emoji
  }
  return {
    myReaction: myEmoji,
    reactions:  ALLOWED_EMOJIS
      .map(e => ({ emoji: e, count: counts[e] ?? 0, reactedByMe: myEmoji === e }))
      .filter(r => r.count > 0),
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  if (!await rateLimit(`reaction:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many reactions' }, { status: 429 })
  }

  const { slug, postId } = await params
  const body = await req.json().catch(() => ({}))
  const emoji: string = ALLOWED_EMOJIS.includes(body.emoji) ? body.emoji : '❤️'

  // Verify club membership (or admin)
  if (session.role !== 'admin') {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
    if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true },
    })
    if (membership?.status !== 'approved') {
      return NextResponse.json({ error: 'Join this club to react' }, { status: 403 })
    }
  }

  const post = await prisma.clubPost.findUnique({ where: { id: postId }, select: { id: true } })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existing = await prisma.clubPostLike.findUnique({
    where: { postId_userId: { postId, userId: session.id } },
    select: { emoji: true },
  })

  if (existing) {
    if (existing.emoji === emoji) {
      await prisma.clubPostLike.delete({ where: { postId_userId: { postId, userId: session.id } } })
    } else {
      await prisma.clubPostLike.update({
        where: { postId_userId: { postId, userId: session.id } },
        data: { emoji },
      })
    }
  } else {
    await prisma.clubPostLike.create({ data: { postId, userId: session.id, emoji } })
  }

  const likes = await prisma.clubPostLike.findMany({ where: { postId }, select: { userId: true, emoji: true } })
  return NextResponse.json(buildReactions(likes, session.id))
}
