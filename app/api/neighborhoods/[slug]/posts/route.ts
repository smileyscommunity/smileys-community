import { NextRequest, NextResponse } from 'next/server'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
import { prisma } from '@/lib/prisma'
import { getSession, type SessionUser } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { rateLimit } from '@/lib/rateLimit'
import { resolveNeighborhoodBySlug } from '@/lib/neighborhoodsDb'
import { buildReactions, buildAuthor } from '@/lib/posts'
import { notifyMentions } from '@/lib/mentions'

// The slug resolves the same way the page does: the viewer's city first, then
// the other public cities. It used to go through the Istanbul-only constant,
// which 404'd every other city's wall on load and on post.
async function resolveWall(slug: string, session: SessionUser) {
  return resolveNeighborhoodBySlug(slug, await resolveCityId(session))
}

type Params = { params: Promise<{ slug: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { slug } = await params
  const wall = await resolveWall(slug, session)
  if (!wall) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined
  const posts = await prisma.neighborhoodPost.findMany({
    // A name is unique only within its city — Moda exists in more than one.
    where: { neighborhood: wall.view.name, cityId: wall.cityId },
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
  const wall = await resolveWall(slug, session)
  if (!wall) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const neighborhood = wall.view.name

  const { content, imageUrl } = await req.json().catch(() => ({}))
  // A non-string content used to reach .trim() and 500.
  if (content != null && typeof content !== 'string') {
    return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
  }
  const trimmed = content?.trim() ?? ''
  if (!trimmed && !imageUrl) return NextResponse.json({ error: 'Content required' }, { status: 400 })
  if (trimmed.length > 2000) return NextResponse.json({ error: 'Post too long (max 2000 chars)' }, { status: 400 })
  if (imageUrl && !isUploadedImageUrl(imageUrl)) {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 })
  }

  const post = await prisma.neighborhoodPost.create({
    data: { neighborhood, userId: session.id, cityId: wall.cityId, content: trimmed, imageUrl: imageUrl ?? null },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
  })

  const link = `/neighborhoods/${slug}`
  notifyMentions({ content: trimmed, authorId: session.id, authorName: session.name, cityId: wall.cityId, link }).catch(() => {})

  return NextResponse.json({
    id: post.id, content: post.content, imageUrl: post.imageUrl,
    isPinned: false, createdAt: post.createdAt,
    author: buildAuthor(post.user),
    reactions: [], replies: [],
  }, { status: 201 })
}
