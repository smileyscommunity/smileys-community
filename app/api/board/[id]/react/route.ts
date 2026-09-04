import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { firstNameOf } from '@/lib/data'

type Params = { params: Promise<{ id: string }> }

// Toggle "interested" or "save" on a post. One endpoint because they're the
// same shape: unique-per-member toggles with no free text, so the abuse
// surface is a notification ping at most — hence a light rate limit.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await rateLimit(`board-react:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too fast — slow down' }, { status: 429 })
  }

  const { id } = await params
  const { kind } = await req.json()
  if (kind !== 'interest' && kind !== 'save') {
    return NextResponse.json({ error: 'Invalid reaction' }, { status: 400 })
  }

  const post = await prisma.boardPost.findUnique({
    where:  { id },
    select: { id: true, userId: true, status: true, title: true, clubId: true, club: { select: { isPrivate: true } } },
  })
  if (!post || post.status !== 'active') return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  // Same private-club gate as replies: a non-member with a private post's id
  // must not be able to ping its author (or confirm the post exists).
  if (post.clubId && post.club?.isPrivate) {
    const member = await prisma.clubMembership.findUnique({
      where:  { userId_clubId: { userId: session.id, clubId: post.clubId } },
      select: { status: true },
    })
    if (member?.status !== 'approved') {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }
  }

  const where = { postId_userId: { postId: id, userId: session.id } }

  if (kind === 'interest') {
    const existing = await prisma.boardInterest.findUnique({ where })
    if (existing) {
      await prisma.boardInterest.delete({ where })
      return NextResponse.json({ active: false })
    }
    await prisma.boardInterest.create({ data: { postId: id, userId: session.id } })
    // Only the first toggle-on notifies — the delete/create cycle above means
    // repeated toggling can't be used to ping the author.
    if (post.userId !== session.id) {
      createNotification(
        post.userId,
        'board_interest',
        `👋 ${firstNameOf(session.name)} is interested`,
        `"${post.title.slice(0, 80)}"`,
        `/board?post=${id}`,
      ).catch(() => {})
    }
    return NextResponse.json({ active: true })
  }

  const existing = await prisma.boardSave.findUnique({ where })
  if (existing) {
    await prisma.boardSave.delete({ where })
    return NextResponse.json({ active: false })
  }
  await prisma.boardSave.create({ data: { postId: id, userId: session.id } })
  return NextResponse.json({ active: true })
}
