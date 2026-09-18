import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit, claimOnce, releaseClaim } from '@/lib/rateLimit'
import { notifyCityStaff } from '@/lib/staffNotify'
import { readablePostWhere } from '@/lib/boardAccess'

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
    const { reason, details, replyId } = (await req.json().catch(() => null)) ?? {}
    if (!reason || !(VALID_REASONS as readonly string[]).includes(reason)) {
      return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })
    }
    if (details && typeof details === 'string' && details.length > 2000) {
      return NextResponse.json({ error: 'Details too long' }, { status: 400 })
    }

    // Only what the reporter can read: a removed post, or a private club's
    // post they aren't in, answers 404 — the same as the reply and save
    // routes, so a report can't confirm a private post exists.
    const post = await prisma.boardPost.findFirst({
      where:  { id: boardPostId, ...readablePostWhere(session.id) },
      select: { id: true, title: true, userId: true, cityId: true },
    })
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // A reply on the post (?replyId): its author is the one reported.
    let target: { userId: string; replyId: string | null; label: string } = { userId: post.userId, replyId: null, label: 'post' }
    if (typeof replyId === 'string' && replyId) {
      const reply = await prisma.boardReply.findUnique({ where: { id: replyId }, select: { postId: true, userId: true, removedAt: true } })
      if (!reply || reply.postId !== post.id || reply.removedAt) return NextResponse.json({ error: 'Reply not found' }, { status: 404 })
      target = { userId: reply.userId, replyId, label: 'reply' }
    }
    if (target.userId === session.id) {
      return NextResponse.json({ error: `Cannot report your own ${target.label}` }, { status: 400 })
    }

    const existing = await prisma.report.findFirst({
      where: { reporterId: session.id, boardPostId, boardReplyId: target.replyId, status: 'pending' },
    })
    if (existing) {
      return NextResponse.json({ error: `You already have a pending report on this ${target.label}` }, { status: 400 })
    }
    // Report has no unique on (reporter, post): a double-submit passed the
    // check above twice and filed two reports and two rounds of staff pushes.
    const claimKey = target.replyId
      ? `report-board-reply:${session.id}:${target.replyId}`
      : `report-board:${session.id}:${boardPostId}`
    if (!await claimOnce(claimKey, 60_000)) {
      return NextResponse.json({ error: `You already have a pending report on this ${target.label}` }, { status: 400 })
    }

    await prisma.report.create({
      data: {
        reporterId: session.id,
        reportedId: target.userId,
        boardPostId,
        boardReplyId: target.replyId,
        reason,
        details: typeof details === 'string' ? details.trim() || null : null,
      },
    })
      // The claim was taken before this write; hand it back if the write fails,
      // or a retry is refused as a duplicate of a report that doesn't exist.
      .catch(async (e: unknown) => { await releaseClaim(claimKey); throw e })

    // The post's city's staff (and admins) — it pinged every moderator in
    // every city.
    await notifyCityStaff(
      post.cityId, 'system_alert',
      target.replyId ? '🚩 Board reply reported' : '🚩 Board post reported',
      `"${post.title.slice(0, 80)}" — ${reason}`,
      '/admin/moderation',
    ).catch(() => {})

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (e) {
    console.error('[board report]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
