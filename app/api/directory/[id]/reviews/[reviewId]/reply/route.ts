import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ id: string; reviewId: string }> }

const REPLY_MAX = 1000

// POST /api/directory/[id]/reviews/[reviewId]/reply — verified owner
// replies to a member's review. Only the user whose ID matches
// Business.claimedById can reply. Re-posting overwrites the previous
// reply (matches Google's owner-reply UX). DELETE clears the reply.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`directory-review-reply:${session.id}`, 20, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many replies. Try again later.' }, { status: 429 })
    }

    const { id, reviewId } = await params
    const review = await prisma.businessReview.findUnique({
      where:  { id: reviewId },
      select: { id: true, businessId: true, business: { select: { claimedById: true } } },
    })
    if (!review || review.businessId !== id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (review.business.claimedById !== session.id) {
      return NextResponse.json({ error: 'Only the verified owner can reply.' }, { status: 403 })
    }

    const body = await req.json().catch(() => null) as { reply?: unknown } | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

    const raw = body.reply
    if (typeof raw !== 'string' || !raw.trim()) {
      return NextResponse.json({ error: 'Reply text required' }, { status: 400 })
    }
    const reply = raw.trim().slice(0, REPLY_MAX)

    await prisma.businessReview.update({
      where: { id: reviewId },
      data:  {
        ownerReply:     reply,
        ownerReplyAt:   new Date(),
        ownerReplyById: session.id,
      },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Review reply POST error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE — owner clears their reply.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id, reviewId } = await params
    const review = await prisma.businessReview.findUnique({
      where:  { id: reviewId },
      select: { id: true, businessId: true, business: { select: { claimedById: true } } },
    })
    if (!review || review.businessId !== id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (review.business.claimedById !== session.id) {
      return NextResponse.json({ error: 'Only the verified owner can clear the reply.' }, { status: 403 })
    }

    await prisma.businessReview.update({
      where: { id: reviewId },
      data:  { ownerReply: null, ownerReplyAt: null, ownerReplyById: null },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Review reply DELETE error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
