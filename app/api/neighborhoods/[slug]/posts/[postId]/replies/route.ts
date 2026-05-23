import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string; postId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (!await rateLimit(`nh-reply-get:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { postId } = await params
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

  const { postId } = await params
  const post = await prisma.neighborhoodPost.findUnique({ where: { id: postId }, select: { id: true } })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const { content } = await req.json()
  const trimmed = content?.trim() ?? ''
  if (!trimmed) return NextResponse.json({ error: 'Content required' }, { status: 400 })
  if (trimmed.length > 1000) return NextResponse.json({ error: 'Reply too long (max 1000 chars)' }, { status: 400 })

  const reply = await prisma.neighborhoodPostReply.create({
    data: { postId, userId: session.id, content: trimmed },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
  })

  return NextResponse.json({
    id: reply.id, content: reply.content, createdAt: reply.createdAt,
    author: { id: reply.user.id, name: reply.user.name, color: reply.user.color, photo: reply.user.profilePhoto, role: reply.user.role },
  }, { status: 201 })
}
