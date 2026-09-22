import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { notifyMentions } from '@/lib/mentions'
import { postMatchesSlug } from '@/lib/neighborhoodsDb'
import { LIVE_BOARD_AUTHOR } from '@/lib/boardAccess'
import { blockedIdsFor } from '@/lib/memberPrivacy'
import { wallAuthors } from '@/lib/wallAuthor'

type Params = { params: Promise<{ slug: string; postId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (!await rateLimit(`nh-reply-get:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { slug, postId } = await params
  // IDOR fix: scope post lookup so the slug in the URL has to match the
  // post's neighborhood. Neighborhoods are public but the slug becomes
  // purely cosmetic otherwise. The column holds the display name ("Kadıköy"),
  // the URL the slug ("kadikoy") — comparing them raw 404'd every reply.
  const post = await prisma.neighborhoodPost.findUnique({ where: { id: postId }, select: { neighborhood: true, cityId: true } })
  if (!post || !await postMatchesSlug(post, slug)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Same rule as the wall itself: a banned, removed or hidden author's
  // replies go, a blocked pair never sees each other, and a connections-only
  // member reads as a first name to someone they aren't connected to.
  const blocked = await blockedIdsFor(session.id)
  const replies = await prisma.neighborhoodPostReply.findMany({
    where: { postId, user: LIVE_BOARD_AUTHOR, ...(blocked.size ? { userId: { notIn: [...blocked] } } : {}) },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true, profileVisibility: true } } },
  })
  const show = await wallAuthors(session, replies.map(r => r.user))

  return NextResponse.json(replies.map(r => ({
    id: r.id, content: r.content, createdAt: r.createdAt,
    author: show(r.user),
  })))
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (!await rateLimit(`nh-reply:${session.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many replies' }, { status: 429 })
  }

  const { slug, postId } = await params
  const post = await prisma.neighborhoodPost.findUnique({ where: { id: postId }, select: { id: true, neighborhood: true, cityId: true } })
  if (!post || !await postMatchesSlug(post, slug)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { content } = await req.json().catch(() => ({}))
  // A non-string content used to reach .trim() and 500.
  if (content != null && typeof content !== 'string') {
    return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
  }
  const trimmed = content?.trim() ?? ''
  if (!trimmed) return NextResponse.json({ error: 'Content required' }, { status: 400 })
  if (trimmed.length > 1000) return NextResponse.json({ error: 'Reply too long (max 1000 chars)' }, { status: 400 })

  const reply = await prisma.neighborhoodPostReply.create({
    data: { postId, userId: session.id, content: trimmed },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
  })

  notifyMentions({ content: trimmed, authorId: session.id, authorName: session.name, cityId: post.cityId, link: `/neighborhoods/${slug}` }).catch(() => {})

  return NextResponse.json({
    id: reply.id, content: reply.content, createdAt: reply.createdAt,
    author: { id: reply.user.id, name: reply.user.name, color: reply.user.color, photo: reply.user.profilePhoto, role: reply.user.role },
  }, { status: 201 })
}
