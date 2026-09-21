import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { LIVE_BOARD_AUTHOR } from '@/lib/boardAccess'
import { isBlockedEitherWay } from '@/lib/memberPrivacy'

// Toggle a saved listing. Answers { saved: boolean }.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`listing-save:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { id: listingId } = await params

  const existing = await prisma.savedListing.findUnique({
    where: { userId_listingId: { userId: session.id, listingId } },
  })

  if (existing) {
    await prisma.savedListing.delete({
      where: { userId_listingId: { userId: session.id, listingId } },
    })
    return NextResponse.json({ saved: false })
  }

  // Only a listing the member could actually open: an unknown id used to
  // reach Prisma as a foreign-key violation and come back as a raw 500, and
  // a removed one (or one whose seller is banned, hidden or blocked) could
  // still be saved into a list that will never show it.
  const listing = await prisma.listing.findFirst({
    where:  { id: listingId, status: 'active', expiresAt: { gte: new Date() }, user: LIVE_BOARD_AUTHOR },
    select: { userId: true },
  })
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (await isBlockedEitherWay(session.id, listing.userId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    await prisma.savedListing.create({ data: { userId: session.id, listingId } })
  } catch (e) {
    // A double tap raced us to it (P2002, the unique on the pair): the member
    // wanted it saved either way. Anything else is a real failure and says so
    // — swallowing it all answered { saved: true } through a database outage.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
  }
  return NextResponse.json({ saved: true })
}
