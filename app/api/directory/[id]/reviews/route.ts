import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ id: string }> }

const COMMENT_MAX = 1500
const RATING_MIN  = 1
const RATING_MAX  = 5

// GET /api/directory/[id]/reviews — public list of non-hidden reviews
// for a business, plus the caller's own review (if any) even when
// hidden so they can see it was moderated.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const session = await getSession()

    const reviews = await prisma.businessReview.findMany({
      where: {
        businessId: id,
        OR: session
          ? [{ isHidden: false }, { authorId: session.id }]
          : [{ isHidden: false }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, rating: true, comment: true,
        ownerReply: true, ownerReplyAt: true,
        isHidden: true, createdAt: true,
        author: { select: { id: true, name: true, color: true, profilePhoto: true } },
        ownerReplyBy: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ reviews })
  } catch (e) {
    console.error('Reviews GET error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// POST /api/directory/[id]/reviews — submit or update the caller's
// review for a business. One row per (business, author) — upsert
// so re-rating just edits the existing row.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 10 review actions per hour per user — generous enough for someone
    // editing a few of their existing reviews, restrictive enough to
    // block spam loops.
    if (!await rateLimit(`directory-review:${session.id}`, 10, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many review actions. Try again later.' }, { status: 429 })
    }

    const { id } = await params
    const business = await prisma.business.findUnique({
      where:  { id },
      select: { id: true, isApproved: true, isActive: true, claimedById: true },
    })
    if (!business || !business.isApproved || !business.isActive) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }
    // Verified owners can't review their own listing — would be free
    // 5-star self-promotion. Same gate is applied at edit time below
    // via the upsert "create" path; the "update" path only fires when
    // a row already exists, so a pre-existing review from before the
    // claim is preserved (admin can hide it if needed).
    if (business.claimedById === session.id) {
      return NextResponse.json({ error: "You can't review a business you've claimed as owner." }, { status: 403 })
    }

    const body = await req.json().catch(() => null) as { rating?: unknown; comment?: unknown } | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

    const ratingNum = Number(body.rating)
    if (!Number.isInteger(ratingNum) || ratingNum < RATING_MIN || ratingNum > RATING_MAX) {
      return NextResponse.json({ error: `Rating must be an integer ${RATING_MIN}-${RATING_MAX}` }, { status: 400 })
    }
    const comment = typeof body.comment === 'string' && body.comment.trim()
      ? body.comment.trim().slice(0, COMMENT_MAX)
      : null

    const review = await prisma.businessReview.upsert({
      where:  { businessId_authorId: { businessId: id, authorId: session.id } },
      create: { businessId: id, authorId: session.id, rating: ratingNum, comment },
      update: {
        rating: ratingNum, comment,
        // Editing the review resets any owner reply — the original reply
        // may no longer be relevant. Owner can re-reply.
        ownerReply: null, ownerReplyAt: null, ownerReplyById: null,
      },
    })
    return NextResponse.json({ ok: true, id: review.id })
  } catch (e) {
    console.error('Reviews POST error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
