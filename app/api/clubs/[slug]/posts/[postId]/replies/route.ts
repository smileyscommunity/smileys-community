import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

type Params = { params: Promise<{ slug: string; postId: string }> }

async function notifyAllMembers(
  clubId: string,
  excludeUserId: string,
  type: string,
  title: string,
  body: string,
  link: string,
) {
  const members = await prisma.clubMembership.findMany({
    where: { clubId, status: 'approved', userId: { not: excludeUserId } },
    select: { userId: true },
  })
  if (!members.length) return

  const memberIds = members.map(m => m.userId)
  const optedOut = await prisma.notificationPreference.findMany({
    where: { userId: { in: memberIds }, wallReplies: false },
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

  if (!await rateLimit(`club-reply:${session.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Slow down — too many replies' }, { status: 429 })
  }

  const { slug, postId } = await params

  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (session.role !== 'admin' && session.role !== 'moderator') {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true },
    })
    if (membership?.status !== 'approved') {
      return NextResponse.json({ error: 'Join this club to reply' }, { status: 403 })
    }
  }

  const post = await prisma.clubPost.findUnique({
    where: { id: postId },
    select: { id: true },
  })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const { content } = await req.json()
  if (!content?.trim()) return NextResponse.json({ error: 'Content is required' }, { status: 400 })
  if (content.trim().length > 1000) return NextResponse.json({ error: 'Reply too long (max 1000 chars)' }, { status: 400 })

  const trimmed = content.trim()

  const reply = await prisma.clubPostReply.create({
    data: { postId, userId: session.id, content: trimmed },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
  })

  notifyAllMembers(
    club.id, session.id,
    'club_post_reply',
    `${session.name} replied in ${club.name}`,
    trimmed.slice(0, 120) + (trimmed.length > 120 ? '…' : ''),
    `/clubs/${slug}`,
  ).catch(() => {})

  notifyMentions(
    trimmed,
    club.id,
    session.id,
    `${session.name} mentioned you in ${club.name}`,
    `/clubs/${slug}`,
  ).catch(() => {})

  const membership = await prisma.clubMembership.findUnique({
    where: { userId_clubId: { userId: session.id, clubId: club.id } },
    select: { role: true },
  })

  return NextResponse.json({
    id:        reply.id,
    content:   reply.content,
    createdAt: reply.createdAt,
    author: {
      id: reply.user.id, name: reply.user.name, color: reply.user.color,
      photo: reply.user.profilePhoto, role: reply.user.role,
      clubRole: membership?.role ?? null,
    },
  })
}
