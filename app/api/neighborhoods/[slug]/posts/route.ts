import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { slugToNeighborhood } from '@/lib/neighborhoods'

type Params = { params: Promise<{ slug: string }> }

const REACTIONS = ['❤️', '👍', '🔥', '😂']

function buildReactions(likes: { userId: string; emoji: string }[], myId?: string) {
  const counts: Record<string, number> = {}
  let myEmoji: string | null = null
  for (const l of likes) {
    counts[l.emoji] = (counts[l.emoji] ?? 0) + 1
    if (l.userId === myId) myEmoji = l.emoji
  }
  return REACTIONS
    .map(e => ({ emoji: e, count: counts[e] ?? 0, reactedByMe: myEmoji === e }))
    .filter(r => r.count > 0)
}

function buildAuthor(u: { id: string; name: string; color: string; profilePhoto: string | null; role: string }) {
  return { id: u.id, name: u.name, color: u.color, photo: u.profilePhoto, role: u.role }
}

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
    reactions:   buildReactions(p.likes, session.id),
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
    data: { neighborhood, userId: session.id, content: trimmed, imageUrl: imageUrl ?? null },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
  })

  return NextResponse.json({
    id: post.id, content: post.content, imageUrl: post.imageUrl,
    isPinned: false, createdAt: post.createdAt,
    author: buildAuthor(post.user),
    reactions: [], replies: [],
  }, { status: 201 })
}
