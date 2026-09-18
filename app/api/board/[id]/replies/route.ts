import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isBlockedEitherWay } from '@/lib/memberPrivacy'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { firstNameOf } from '@/lib/data'
import { authorProjector } from '@/lib/authorProjection'
import { canActInCity } from '@/lib/access'
import { readablePostWhere, blockedPairIds, SHOWN_REPLY, redactBoardTextForGuest } from '@/lib/boardAccess'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  // Same gate as the board feed's deep link (lib/boardAccess): a removed
  // post's thread, a banned author's post, a private club's conversation and
  // a blocked member's post are not readable straight off this endpoint.
  const session = await getSession()
  const blocked = await blockedPairIds(session?.id ?? null)
  const post = await prisma.boardPost.findFirst({
    where:  { id, ...readablePostWhere(session?.id ?? null), ...(blocked.length ? { userId: { notIn: blocked } } : {}) },
    select: { id: true, userId: true, cityId: true },
  })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  // The newest 200, shown oldest first: taking the oldest 200 hid the latest
  // replies (your own included) on a long thread.
  const replies = (await prisma.boardReply.findMany({
    where:   { postId: id, ...SHOWN_REPLY, ...(blocked.length ? { userId: { notIn: blocked } } : {}) },
    orderBy: { createdAt: 'desc' },
    take:    200,
    select: {
      id: true, body: true, parentId: true, createdAt: true,
      user: { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } },
    },
  })).reverse()
  // A reply whose parent isn't shown (taken down, a banned author, blocked)
  // stands on its own rather than vanishing with it.
  const shownIds = new Set(replies.map(r => r.id))
  // Same author rule as the board feed (lib/authorProjection).
  const project = await authorProjector(session, replies.map(r => r.user))
  const staff = !!session && canActInCity(session, post.cityId)
  return NextResponse.json({
    replies: replies.map(r => ({
      id: r.id, createdAt: r.createdAt,
      body: session ? r.body : redactBoardTextForGuest(r.body),
      parentId: r.parentId && shownIds.has(r.parentId) ? r.parentId : null,
      user: project(r.user),
      // Its author, the post's author, or staff of the post's city.
      canRemove: !!session && (r.user.id === session.id || post.userId === session.id || staff),
    })),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`board-reply:${session.id}`, 10, 60_000))        return NextResponse.json({ error: 'Replying too fast — slow down' }, { status: 429 })
  if (!await rateLimit(`board-reply-day:${session.id}`, 60, 86_400_000)) return NextResponse.json({ error: 'Daily reply limit reached' }, { status: 429 })

  const { id } = await params
  const post = await prisma.boardPost.findUnique({
    where:  { id },
    select: { id: true, userId: true, status: true, title: true, clubId: true, club: { select: { isPrivate: true } }, city: { select: { slug: true } } },
  })
  if (!post || post.status !== 'active') return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  // A block is a block on the board too — DM and listing contact already
  // refuse it; replying/"interested" pinged the author by name regardless.
  // After the status gate so a blocked member learns nothing a stranger
  // wouldn't about a removed post.
  if (post.userId !== session.id && await isBlockedEitherWay(session.id, post.userId)) {
    return NextResponse.json({ error: 'Cannot interact with this member' }, { status: 403 })
  }

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
  // Whose reply this answers — they hear about it too (only the post's
  // author did, though the thread said "Replying to <name>").
  let repliedTo: string | null = null
  if (typeof raw.parentId === 'string' && raw.parentId) {
    const parent = await prisma.boardReply.findUnique({
      where:  { id: raw.parentId },
      select: { id: true, postId: true, parentId: true, userId: true, removedAt: true },
    })
    if (!parent || parent.postId !== id || parent.removedAt) return NextResponse.json({ error: 'Invalid reply target' }, { status: 400 })
    parentId = parent.parentId ?? parent.id
    repliedTo = parent.userId
  }

  const created = await prisma.boardReply.create({
    data: { postId: id, userId: session.id, parentId, body },
    select: {
      id: true, body: true, parentId: true, createdAt: true,
      user: { select: { id: true, name: true, color: true, profilePhoto: true } },
    },
  })

  // Linked to the post's own city: /board?post= alone opened on the
  // reader's cookie city (the post is prepended either way, but the feed
  // around it was another city's).
  const link = `/board?post=${id}&city=${post.city.slug}`
  if (post.userId !== session.id) {
    createNotification(
      post.userId,
      'board_reply',
      `💬 ${firstNameOf(session.name)} replied to your post`,
      `"${post.title.slice(0, 80)}" — ${body.slice(0, 100)}`,
      link,
    ).catch(() => {})
  }
  if (repliedTo && repliedTo !== session.id && repliedTo !== post.userId && !await isBlockedEitherWay(session.id, repliedTo)) {
    createNotification(
      repliedTo,
      'board_reply',
      `💬 ${firstNameOf(session.name)} replied to you`,
      `"${post.title.slice(0, 80)}" — ${body.slice(0, 100)}`,
      link,
    ).catch(() => {})
  }

  return NextResponse.json({ reply: created }, { status: 201 })
}
