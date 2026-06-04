import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ id: string; reviewId: string }> }

// DELETE /api/directory/[id]/reviews/[reviewId] — author deletes their
// own review. Admins use the moderation API instead (PATCH isHidden).
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Same budget as the POST sibling — a delete-then-recreate churn
    // loop is the abuse case worth blocking, so the two paths share
    // one counter.
    if (!await rateLimit(`directory-review:${session.id}`, 10, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many review actions. Try again later.' }, { status: 429 })
    }

    const { reviewId } = await params
    const review = await prisma.businessReview.findUnique({
      where:  { id: reviewId },
      select: { id: true, authorId: true },
    })
    if (!review || review.authorId !== session.id) {
      // Don't leak whether the row exists vs is owned by someone else.
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.businessReview.delete({ where: { id: reviewId } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Reviews DELETE error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
