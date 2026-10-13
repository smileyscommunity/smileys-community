import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { ACTIVATED_MEMBER_WHERE } from '@/lib/memberCount'
import { rateLimit } from '@/lib/rateLimit'
import { isSafeHref } from '@/lib/safeUrl'

// A restricted offer attached to an article (PostMemberOffer). This is the
// ONLY place it is read. The check is server-side and re-done on every call:
// a signed-in, approved, activated, not-banned member, on a published story.
// Everyone else gets the same bare 404 whether or not an offer exists, so the
// route doesn't confirm that one does. Never cached, never indexed.
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }
const none = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: HEADERS })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession()
  if (!session) return none()
  if (!await rateLimit(`post-offer:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: HEADERS })
  }

  const member = await prisma.user.findFirst({ where: { id: session.id, ...ACTIVATED_MEMBER_WHERE }, select: { id: true } })
  if (!member) return none()

  const { slug } = await params
  const offer = await prisma.postMemberOffer.findFirst({
    where: { active: true, post: { slug, status: 'published', kind: 'community' } },
    select: { label: true, url: true, code: true, note: true },
  })
  if (!offer) return none()
  return NextResponse.json({ ...offer, url: offer.url && isSafeHref(offer.url) ? offer.url : null }, { headers: HEADERS })
}
