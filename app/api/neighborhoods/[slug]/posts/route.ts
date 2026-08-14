import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { rateLimit } from '@/lib/rateLimit'
import { slugToNeighborhood } from '@/lib/neighborhoods'
import { buildReactions, buildAuthor } from '@/lib/posts'
import { createNotification } from '@/lib/notify'

async function notifyMentions(content: string, excludeUserId: string, authorName: string, link: string) {
  const matches = [...content.matchAll(/@(\w+)/g)].map(m => m[1])
  if (!matches.length) return
  const users = await prisma.user.findMany({
    where: {
      status: 'approved',
      id:     { not: excludeUserId },
      OR: matches.map(word => ({ name: { startsWith: word, mode: 'insensitive' as const } })),
    },
    select: { id: true },
  })
  if (!users.length) return
  await Promise.allSettled(
    users.map(u =>
      createNotification(u.id, 'neighborhood_mention', `${authorName} mentioned you`, content.slice(0, 120), link)
    )
  )
}

type Params = { params: Promise<{ slug: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { slug } = await params
  const neighborhood = slugToNeighborhood(slug)
  if (!neighborhood) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined
  const posts = await prisma.neighborhoodPost.findMany({
    where: { neighborhood },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: 30,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      user:    { select: { id: true, name: true, color: true, profilePhoto: true, role: true } },
      likes:   { select: { userId: true, emoji: true } },
      replies: {
        orderBy: { createdAt: 'asc' },
        take: 20,
        include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
      },
      _count: { select: { replies: true } },
    },
  })

  return NextResponse.json(posts.map(p => ({
    id:          p.id,
    content:     p.content,
    imageUrl:    p.imageUrl,
    isPinned:    p.isPinned,
    createdAt:   p.createdAt,
    author:      buildAuthor(p.user),
    reactions:   buildReactions(p.likes, session.id).reactions,
    replyCount:  p._count.replies,
    replies:     p.replies.map(r => ({
      id: r.id, content: r.content, createdAt: r.createdAt, author: buildAuthor(r.user),
    })),
  })))
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (!await rateLimit(`nh-post:${session.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Slow down — too many posts' }, { status: 429 })
  }

  const { slug } = await params
  const neighborhood = slugToNeighborhood(slug)
  if (!neighborhood) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { content, imageUrl } = await req.json()
  const trimmed = content?.trim() ?? ''
  if (!trimmed && !imageUrl) return NextResponse.json({ error: 'Content required' }, { status: 400 })
  if (trimmed.length > 2000) return NextResponse.json({ error: 'Post too long (max 2000 chars)' }, { status: 400 })
  if (imageUrl && !/^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(imageUrl)) {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 })
  }

  const post = await prisma.neighborhoodPost.create({
    data: { neighborhood, userId: session.id, cityId: await resolveCityId(session), content: trimmed, imageUrl: imageUrl ?? null },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
  })

  const link = `/neighborhoods/${slug}`
  notifyMentions(trimmed, session.id, session.name, link).catch(() => {})

  return NextResponse.json({
    id: post.id, content: post.content, imageUrl: post.imageUrl,
    isPinned: false, createdAt: post.createdAt,
    author: buildAuthor(post.user),
    reactions: [], replies: [],
  }, { status: 201 })
}
