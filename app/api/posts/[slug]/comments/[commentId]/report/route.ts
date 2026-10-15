import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit, claimOnce, releaseClaim } from '@/lib/rateLimit'
import { notifyCityStaff } from '@/lib/staffNotify'

// Same Report table and moderation queue as board replies; the comment's
// author is the member reported.
const VALID_REASONS = ['spam', 'scam', 'inappropriate', 'duplicate', 'other'] as const

type Params = { params: Promise<{ slug: string; commentId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`post-comment-report:${session.id}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many reports. Try again later.' }, { status: 429 })
    }

    const { slug, commentId } = await params
    const { reason, details } = (await req.json().catch(() => null)) ?? {}
    if (!reason || !(VALID_REASONS as readonly string[]).includes(reason)) {
      return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })
    }
    if (details && typeof details === 'string' && details.length > 2000) {
      return NextResponse.json({ error: 'Details too long' }, { status: 400 })
    }

    const c = await prisma.postComment.findUnique({
      where:  { id: commentId },
      select: { userId: true, removedAt: true, body: true, post: { select: { slug: true, title: true, cityId: true, status: true } } },
    })
    if (!c || c.removedAt || c.post.slug !== slug || c.post.status !== 'published') {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }
    if (c.userId === session.id) return NextResponse.json({ error: 'Cannot report your own comment' }, { status: 400 })

    const existing = await prisma.report.findFirst({ where: { reporterId: session.id, postCommentId: commentId, status: 'pending' } })
    if (existing) return NextResponse.json({ error: 'You already have a pending report on this comment' }, { status: 400 })
    const claimKey = `report-post-comment:${session.id}:${commentId}`
    if (!await claimOnce(claimKey, 60_000)) {
      return NextResponse.json({ error: 'You already have a pending report on this comment' }, { status: 400 })
    }

    await prisma.report.create({
      data: {
        reporterId: session.id, reportedId: c.userId, postCommentId: commentId, reason,
        details: typeof details === 'string' ? details.trim() || null : null,
      },
    }).catch(async (e: unknown) => { await releaseClaim(claimKey); throw e })

    await notifyCityStaff(
      c.post.cityId, 'system_alert', '🚩 Story comment reported',
      `"${c.post.title.slice(0, 80)}" — ${reason}`, '/admin/moderation',
      [c.userId, session.id],
    ).catch(() => {})

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (e) {
    console.error('[story comment report]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
