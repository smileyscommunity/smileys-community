import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'
import { firstNameOf } from '@/lib/data'

// POST /api/listings/[id]/contact — "Contact the seller" as an internal DM.
//
// This bypasses the DM connection gate the same way the visiting wave does,
// and for the same reason: a listing is an explicit invitation for contact.
// Unlike the wave the text is editable — a fixed template is useless for
// transactions ("is it available? can I come at 5?") — so the scoping does
// the safety work instead:
//   - active listing required; channel closes when it expires or fills
//   - once per listing per sender (30d) — you contact a seller about an
//     item once, then the thread exists and normal DM rules take over
//     (the seller can reply via the inbound-thread exception)
//   - 10 first-contacts/day, blocks both ways, no anonymous senders
//   - URLs stripped: first contact never needs a link, and an unconsented
//     channel must not carry one
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: listingId } = await params
  const listing = await prisma.listing.findUnique({
    where:  { id: listingId },
    select: { id: true, title: true, status: true, expiresAt: true, userId: true, user: { select: { name: true, status: true } } },
  })
  if (!listing || listing.user.status !== 'approved') return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (listing.status !== 'active' || listing.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This listing is no longer active' }, { status: 400 })
  }
  if (listing.userId === session.id) {
    return NextResponse.json({ error: 'This is your own listing' }, { status: 400 })
  }

  const raw = await req.json()
  const text = typeof raw.text === 'string'
    ? raw.text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 300)
    : ''
  if (!text) return NextResponse.json({ error: 'Write a short message first' }, { status: 400 })

  const block = await prisma.memberBlock.findFirst({
    where: { OR: [
      { blockerId: session.id, blockedId: listing.userId },
      { blockerId: listing.userId, blockedId: session.id },
    ] },
    select: { id: true },
  })
  if (block) return NextResponse.json({ error: 'Cannot contact this member' }, { status: 403 })

  // Rate limits after validation so a doomed request never burns the
  // once-per-listing slot (same ordering as the visiting tip endpoint).
  if (!await rateLimit(`listing-contact:${session.id}`, 10, 24 * 60 * 60_000)) {
    return NextResponse.json({ error: 'Daily contact limit reached' }, { status: 429 })
  }
  if (!await rateLimit(`listing-contact-once:${session.id}:${listingId}`, 1, 30 * 24 * 60 * 60_000)) {
    return NextResponse.json({ error: 'You already contacted this seller — check your messages' }, { status: 429 })
  }

  await prisma.directMessage.create({
    data: { fromId: session.id, toId: listing.userId, text: `🛍️ Re: "${listing.title.slice(0, 60)}" — ${text}` },
  })

  createNotification(
    listing.userId,
    'message',
    `🛍️ ${firstNameOf(session.name)} is interested in your listing`,
    `"${listing.title.slice(0, 60)}" — ${text.slice(0, 100)}`,
    `/messages/${session.id}`,
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}
