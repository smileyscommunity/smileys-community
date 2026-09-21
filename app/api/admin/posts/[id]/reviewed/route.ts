import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePosts, canActOnCityContent, isAdmin } from '@/lib/access'
import { requireStepUp } from '@/lib/stepUp'
import { writeAudit } from '@/lib/audit'

// "Reviewed today" — the one way `lastReviewedAt` moves. It is never derived
// from an edit (a typo fix is not a review) and the form has no field for it:
// a staff member presses this on the article page after checking it against
// the official sources, and the page's trust line is earned, not typed.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const post = await prisma.post.findUnique({ where: { id }, select: { title: true, kind: true, cityId: true, lastReviewedAt: true } })
  if (!post || post.kind !== 'handbook') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canActOnCityContent(session, post.cityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // A review is a claim readers act on: step-up for admins, as with publish.
  if (isAdmin(session)) {
    const gate = requireStepUp(session)
    if (gate) return gate
  }

  const now = new Date()
  await prisma.post.update({ where: { id }, data: { lastReviewedAt: now } })
  writeAudit(session.id, session.name, 'post.reviewed', id, 'post',
    { title: post.title, previous: post.lastReviewedAt?.toISOString() ?? null },
    `Marked "${post.title}" as reviewed`,
  )
  revalidateTag('handbook')
  return NextResponse.json({ ok: true, lastReviewedAt: now.toISOString() })
}
