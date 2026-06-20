import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
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
  // purely cosmetic otherwise.
  const post = await prisma.neighborhoodPost.findUnique({ where: { id: postId }, select: { neighborhood: true } })
  if (!post || post.neighborhood !== slug) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const replies = await prisma.neighborhoodPostReply.findMany({
    where: { postId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
  })

  return NextResponse.json(replies.map(r => ({
    id: r.id, content: r.content, createdAt: r.createdAt,
    author: { id: r.user.id, name: r.user.name, color: r.user.color, photo: r.user.profilePhoto, role: r.user.role },
  })))
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (!await rateLimit(`nh-reply:${session.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many replies' }, { status: 429 })
  }

  const { slug, postId } = await params
  const post = await prisma.neighborhoodPost.findUnique({ where: { id: postId }, select: { id: true, neighborhood: true } })
  if (!post || post.neighborhood !== slug) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { content } = await req.json()
  const trimmed = content?.trim() ?? ''
  if (!trimmed) return NextResponse.json({ error: 'Content required' }, { status: 400 })
  if (trimmed.length > 1000) return NextResponse.json({ error: 'Reply too long (max 1000 chars)' }, { status: 400 })

  const reply = await prisma.neighborhoodPostReply.create({
    data: { postId, userId: session.id, content: trimmed },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
  })

  notifyMentions(trimmed, session.id, session.name, `/neighborhoods/${slug}`).catch(() => {})

  return NextResponse.json({
    id: reply.id, content: reply.content, createdAt: reply.createdAt,
    author: { id: reply.user.id, name: reply.user.name, color: reply.user.color, photo: reply.user.profilePhoto, role: reply.user.role },
  }, { status: 201 })
}
