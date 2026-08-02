import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

// Mirrors the listings report route: same Report table, same reasons, same
// staff notification — board flags land in the existing moderation queue
// rather than a parallel one.
const VALID_REASONS = ['spam', 'scam', 'inappropriate', 'duplicate', 'other'] as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`board-report:${session.id}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many reports. Try again later.' }, { status: 429 })
    }

    const { id: boardPostId } = await params
    const { reason, details } = await req.json()
    if (!reason || !(VALID_REASONS as readonly string[]).includes(reason)) {
      return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })
    }
    if (details && typeof details === 'string' && details.length > 2000) {
      return NextResponse.json({ error: 'Details too long' }, { status: 400 })
    }

    const post = await prisma.boardPost.findUnique({
      where:  { id: boardPostId },
      select: { id: true, title: true, userId: true },
    })
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    if (post.userId === session.id) {
      return NextResponse.json({ error: 'Cannot report your own post' }, { status: 400 })
    }

    const existing = await prisma.report.findFirst({
      where: { reporterId: session.id, boardPostId, status: 'pending' },
    })
    if (existing) {
      return NextResponse.json({ error: 'You already have a pending report on this post' }, { status: 400 })
    }

    await prisma.report.create({
      data: {
        reporterId: session.id,
        reportedId: post.userId,
        boardPostId,
        reason,
        details: typeof details === 'string' ? details.trim() || null : null,
      },
    })

    const staff = await prisma.user.findMany({
      where:  { role: { in: ['admin', 'moderator'] } },
      select: { id: true },
    })
    for (const s of staff) {
      createNotification(
        s.id, 'system_alert',
        '🚩 Board post reported',
        `"${post.title.slice(0, 80)}" — ${reason}`,
        '/admin/moderation',
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (e) {
    console.error('[board report]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
