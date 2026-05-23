import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

type Params = { params: Promise<{ slug: string }> }

const REACTION_EMOJIS = ['❤️', '👍', '🔥', '😂']

function buildReactions(likes: { userId: string; emoji: string }[], sessionId?: string) {
  const counts: Record<string, number> = {}
  let myEmoji: string | null = null
  for (const l of likes) {
    counts[l.emoji] = (counts[l.emoji] ?? 0) + 1
    if (l.userId === sessionId) myEmoji = l.emoji
  }
  return REACTION_EMOJIS
    .map(e => ({ emoji: e, count: counts[e] ?? 0, reactedByMe: myEmoji === e }))
    .filter(r => r.count > 0)
}

function buildPoll(
  poll: {
    id: string; question: string
    options: { id: string; text: string; order: number; votes: { userId: string }[] }[]
    votes:   { userId: string; optionId: string }[]
  } | null,
  sessionId?: string,
) {
  if (!poll) return null
  const myVote = poll.votes.find(v => v.userId === sessionId)
  const totalVotes = poll.votes.length
  return {
    id:             poll.id,
    question:       poll.question,
    totalVotes,
    myVoteOptionId: myVote?.optionId ?? null,
    options: poll.options
      .sort((a, b) => a.order - b.order)
      .map(o => ({
        id:          o.id,
        text:        o.text,
        voteCount:   o.votes.length,
        votedByMe:   myVote?.optionId === o.id,
      })),
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { slug } = await params
  const type = req.nextUrl.searchParams.get('type') ?? 'post'

  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, isPrivate: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Private clubs: only members, hosts, admins, or moderators can read the wall
  if (club.isPrivate && !isAdminOrModerator(session)) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true },
    })
    if (membership?.status !== 'approved') {
      return NextResponse.json({ error: 'Members only' }, { status: 403 })
    }
  }

  const posts = await prisma.clubPost.findMany({
    where: { clubId: club.id, type },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: 50,
    include: {
      user:    { select: { id: true, name: true, color: true, profilePhoto: true, role: true } },
      likes:   { select: { userId: true, emoji: true } },
      replies: {
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
      },
      poll: {
        include: {
          options: { include: { votes: { select: { userId: true } } } },
          votes:   { select: { userId: true, optionId: true } },
        },
      },
    },
  })

  const authorIds = [...new Set([
    ...posts.map(p => p.user.id),
    ...posts.flatMap(p => p.replies.map(r => r.user.id)),
  ])]
  const memberships = await prisma.clubMembership.findMany({
    where: { clubId: club.id, userId: { in: authorIds } },
    select: { userId: true, role: true },
  })
  const clubRoleMap = new Map(memberships.map(m => [m.userId, m.role]))

  function buildAuthor(u: { id: string; name: string; color: string; profilePhoto: string | null; role: string }) {
    return { id: u.id, name: u.name, color: u.color, photo: u.profilePhoto, role: u.role, clubRole: clubRoleMap.get(u.id) ?? null }
  }

  return NextResponse.json(posts.map(p => ({
    id:        p.id,
    content:   p.content,
    type:      p.type,
    createdAt: p.createdAt,
    isPinned:  p.isPinned,
    author:    buildAuthor(p.user),
    reactions: buildReactions(p.likes, session?.id),
    poll:      buildPoll(p.poll, session?.id),
    replies:   p.replies.map(r => ({
      id: r.id, content: r.content, createdAt: r.createdAt, author: buildAuthor(r.user),
    })),
  })))
}

async function notifyAllMembers(
  clubId: string, excludeUserId: string, prefKey: 'wallPosts' | 'wallReplies',
  type: string, title: string, body: string, link: string,
) {
  const members = await prisma.clubMembership.findMany({
    where: { clubId, status: 'approved', userId: { not: excludeUserId } },
    select: { userId: true },
  })
  if (!members.length) return
  const memberIds = members.map(m => m.userId)
  const optedOut = await prisma.notificationPreference.findMany({
    where: { userId: { in: memberIds }, [prefKey]: false },
    select: { userId: true },
  })
  const optedOutIds = new Set(optedOut.map(p => p.userId))
  const toNotify = memberIds.filter(id => !optedOutIds.has(id))
  if (!toNotify.length) return
  await prisma.notification.createMany({
    data: toNotify.map(userId => ({ userId, type, title, body, link })),
  })
}

async function notifyMentions(
  content: string,
  clubId: string,
  excludeUserId: string,
  title: string,
  link: string,
) {
  const matches = [...content.matchAll(/@(\w+)/g)].map(m => m[1])
  if (!matches.length) return
  const members = await prisma.clubMembership.findMany({
    where: { clubId, status: 'approved', userId: { not: excludeUserId } },
    include: { user: { select: { id: true, name: true } } },
  })
  const toNotify: string[] = []
  for (const word of matches) {
    for (const m of members) {
      if (m.user.name.toLowerCase().startsWith(word.toLowerCase()) && !toNotify.includes(m.userId)) {
        toNotify.push(m.userId)
      }
    }
  }
  if (!toNotify.length) return
  await Promise.allSettled(
    toNotify.map(userId =>
      createNotification(userId, 'club_mention', title, content.slice(0, 120), link)
    )
  )
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  if (!await rateLimit(`club-post:${session.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Slow down — too many posts' }, { status: 429 })
  }

  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isPrivileged = isAdminOrModerator(session)
  let membership: { status: string; role: string } | null = null

  // Admins and moderators bypass membership check; everyone else must be an approved member
  if (!isPrivileged) {
    membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true, role: true },
    })
    if (membership?.status !== 'approved') {
      return NextResponse.json({ error: 'Join this club to post' }, { status: 403 })
    }
  }

  const body = await req.json()
  const { content, poll: pollData, type = 'post' } = body

  if (type !== 'post' && type !== 'announcement') {
    return NextResponse.json({ error: 'Invalid post type' }, { status: 400 })
  }

  const isHost = membership?.role === 'host'
  if (type === 'announcement' && !isHost && !isPrivileged) {
    return NextResponse.json({ error: 'Only hosts, admins, or moderators can post announcements' }, { status: 403 })
  }

  if (!content?.trim() && !pollData) return NextResponse.json({ error: 'Content is required' }, { status: 400 })
  if (content?.trim().length > 2000) return NextResponse.json({ error: 'Post too long (max 2000 chars)' }, { status: 400 })

  if (pollData) {
    if (!pollData.question?.trim()) return NextResponse.json({ error: 'Poll question is required' }, { status: 400 })
    if (!Array.isArray(pollData.options) || pollData.options.length < 2) {
      return NextResponse.json({ error: 'Poll needs at least 2 options' }, { status: 400 })
    }
    if (pollData.options.length > 6) return NextResponse.json({ error: 'Max 6 poll options' }, { status: 400 })
    if (pollData.options.some((o: string) => !o?.trim())) {
      return NextResponse.json({ error: 'All poll options must have text' }, { status: 400 })
    }
  }

  // RSVP gating: regular members (not hosts, admins, or moderators) must have attended a club event
  if (type === 'post' && !isHost && !isPrivileged) {
    const attended = await prisma.eventAttendee.findFirst({
      where: { userId: session.id, status: 'approved', event: { clubId: club.id } },
    })
    if (!attended) {
      return NextResponse.json({ error: 'Attend a club event first to post on the wall' }, { status: 403 })
    }
  }

  const trimmed = content?.trim() ?? ''

  const post = await prisma.$transaction(async tx => {
    const p = await tx.clubPost.create({
      data: { clubId: club.id, userId: session.id, content: trimmed, type },
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
    })
    if (pollData) {
      await tx.clubPoll.create({
        data: {
          postId:   p.id,
          question: pollData.question.trim(),
          options:  {
            create: (pollData.options as string[]).map((text, i) => ({ text: text.trim(), order: i })),
          },
        },
      })
    }
    return p
  })

  const fullPost = await prisma.clubPost.findUnique({
    where: { id: post.id },
    include: {
      poll: { include: { options: { include: { votes: { select: { userId: true } } } }, votes: { select: { userId: true, optionId: true } } } },
    },
  })

  const resolvedMembership = membership ?? await prisma.clubMembership.findUnique({
    where: { userId_clubId: { userId: session.id, clubId: club.id } },
    select: { role: true },
  })

  notifyAllMembers(
    club.id, session.id, 'wallPosts', 'club_wall_post',
    `${session.name} posted in ${club.name}`,
    trimmed.slice(0, 120) + (trimmed.length > 120 ? '…' : ''),
    `/clubs/${slug}`,
  ).catch(() => {})

  if (trimmed) {
    notifyMentions(
      trimmed,
      club.id,
      session.id,
      `${session.name} mentioned you in ${club.name}`,
      `/clubs/${slug}`,
    ).catch(() => {})
  }

  return NextResponse.json({
    id:        post.id,
    content:   post.content,
    type:      post.type,
    createdAt: post.createdAt,
    isPinned:  false,
    author: {
      id: post.user.id, name: post.user.name, color: post.user.color,
      photo: post.user.profilePhoto, role: post.user.role,
      clubRole: resolvedMembership?.role ?? null,
    },
    reactions: [],
    poll:      buildPoll(fullPost?.poll ?? null, session.id),
    replies:   [],
  })
}
