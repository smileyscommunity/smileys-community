import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { firstNameOf } from '@/lib/data'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  // Same gates as the board feed's deep-link path (app/api/board/route.ts):
  // a removed post's thread, a banned author's post, and a private club's
  // conversation must not be readable straight off this endpoint either.
  const session = await getSession()
  const post = await prisma.boardPost.findFirst({
    where: {
      id, status: 'active',
      user: { status: 'approved' },
      OR: [
        { clubId: null },
        { club: { isPrivate: false } },
        ...(session ? [{ club: { memberships: { some: { userId: session.id, status: 'approved' } } } }] : []),
      ],
    },
    select: { id: true },
  })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const replies = await prisma.boardReply.findMany({
    where:   { postId: id, user: { status: 'approved' } },
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
    select: { id: true, userId: true, status: true, title: true, clubId: true, club: { select: { isPrivate: true } } },
  })
  if (!post || post.status !== 'active') return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  // A private club's thread accepts replies only from its approved members —
  // same gate the feed applies to reading it. (Public-club posts surface in
  // the general feed, so any member may reply to those, matching the post
  // route's read semantics.)
  if (post.clubId && post.club?.isPrivate) {
    const member = await prisma.clubMembership.findUnique({
      where:  { userId_clubId: { userId: session.id, clubId: post.clubId } },
      select: { status: true },
    })
    if (member?.status !== 'approved') {
      // 404, not 403 — same as the GET above, so a non-member can't
      // use either method to confirm a private post's id exists.
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }
  }

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
      `💬 ${firstNameOf(session.name)} replied to your post`,
      `"${post.title.slice(0, 80)}" — ${body.slice(0, 100)}`,
      `/board?post=${id}`,
    ).catch(() => {})
  }

  return NextResponse.json({ reply: created }, { status: 201 })
}
