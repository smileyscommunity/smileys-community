import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const replies = await prisma.boardReply.findMany({
    where:   { postId: id },
    orderBy: { createdAt: 'asc' },
    take:    200,
    select: {
      id: true, body: true, parentId: true, createdAt: true,
      user: { select: { id: true, name: true, color: true, profilePhoto: true } },
    },
  })
  return NextResponse.json({ replies })
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`board-reply:${session.id}`, 10, 60_000))        return NextResponse.json({ error: 'Replying too fast — slow down' }, { status: 429 })
  if (!await rateLimit(`board-reply-day:${session.id}`, 60, 86_400_000)) return NextResponse.json({ error: 'Daily reply limit reached' }, { status: 429 })

  const { id } = await params
  const post = await prisma.boardPost.findUnique({
    where:  { id },
    select: { id: true, userId: true, status: true, title: true },
  })
  if (!post || post.status !== 'active') return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const raw = await req.json()
  const body = typeof raw.body === 'string' ? raw.body.trim().slice(0, 500) : ''
  if (!body) return NextResponse.json({ error: 'Reply cannot be empty' }, { status: 400 })

  // Same one-link cap as posts — replies have a 60/day allowance, which is
  // otherwise the bigger link-spam surface.
  if ((body.match(/\b(?:https?:\/\/|www\.)\S+/gi) ?? []).length > 1) {
    return NextResponse.json({ error: 'One link per reply, please' }, { status: 400 })
  }

  // One level of nesting only: replying to a nested reply re-anchors to its
  // top-level parent, so depth can never exceed one regardless of input.
  let parentId: string | null = null
  if (typeof raw.parentId === 'string' && raw.parentId) {
    const parent = await prisma.boardReply.findUnique({
      where:  { id: raw.parentId },
      select: { id: true, postId: true, parentId: true },
    })
    if (!parent || parent.postId !== id) return NextResponse.json({ error: 'Invalid reply target' }, { status: 400 })
    parentId = parent.parentId ?? parent.id
  }

  const created = await prisma.boardReply.create({
    data: { postId: id, userId: session.id, parentId, body },
    select: {
      id: true, body: true, parentId: true, createdAt: true,
      user: { select: { id: true, name: true, color: true, profilePhoto: true } },
    },
  })

  if (post.userId !== session.id) {
    createNotification(
      post.userId,
      'board_reply',
      `💬 ${session.name.split(' ')[0]} replied to your post`,
      `"${post.title.slice(0, 80)}" — ${body.slice(0, 100)}`,
      `/board?post=${id}`,
    ).catch(() => {})
  }

  return NextResponse.json({ reply: created }, { status: 201 })
}
