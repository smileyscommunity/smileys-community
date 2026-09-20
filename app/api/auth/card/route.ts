import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { mintCardToken } from '@/lib/cardToken'
import { rateLimit } from '@/lib/rateLimit'

// The member card's QR code. Minted here rather than drawn from the member's
// id on the page, so a screenshot stops working (lib/cardToken) — and fetched
// on its own, small and cheap, because the card has to be openable at a door
// on a bad connection and cached for the one with no connection at all.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (!await rateLimit(`card-token:${session.id}`, 60, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // A suspended or banned member has no card: getSession already ends their
  // session, so this is the belt on top of the braces.
  const user = await prisma.user.findUnique({
    where:  { id: session.id },
    select: { status: true, suspendedUntil: true },
  })
  if (!user || user.status !== 'approved' || (user.suspendedUntil && user.suspendedUntil > new Date())) {
    return NextResponse.json({ error: 'Not an active member' }, { status: 403 })
  }

  const { value, expiresAt } = mintCardToken(session.id)
  return NextResponse.json({ token: value, expiresAt: expiresAt.toISOString() })
}
