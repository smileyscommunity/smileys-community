import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, canActInCity } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/admin/directory/reviews/[id]
// body: { hide: boolean }
//
// Hidden reviews stay in the DB but don't render in the public list or
// count toward the average. Author still sees their own hidden review.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const body = await req.json().catch(() => null) as { hide?: unknown } | null
    if (!body || typeof body.hide !== 'boolean') {
      return NextResponse.json({ error: 'Missing `hide` boolean' }, { status: 400 })
    }

    const review = await prisma.businessReview.findUnique({
      where: { id }, select: { id: true, businessId: true, business: { select: { cityId: true } } },
    })
    if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canActInCity(session, review.business.cityId)) {
      return NextResponse.json({ error: 'Cross-city moderation is admin-only' }, { status: 403 })
    }

    await prisma.businessReview.update({
      where: { id },
      data:  { isHidden: body.hide },
    })
    await writeAudit(
      session.id, session.name,
      body.hide ? 'directory.review_hide' : 'directory.review_unhide',
      id, 'business_review',
      { businessId: review.businessId },
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Admin review moderation error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
