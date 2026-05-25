import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

// Mirrors /api/reports POST but derives reportedId from the listing's owner so
// the client only needs to send the reason. Reuses the existing Report model
// (with the new listingId field) so admin moderation surfaces both user and
// listing flags in one place.

const VALID_REASONS = ['spam', 'scam', 'inappropriate', 'duplicate', 'other'] as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`listing-report:${session.id}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many reports. Try again later.' }, { status: 429 })
    }

    const { id: listingId } = await params
    const { reason, details } = await req.json()

    if (!reason || !(VALID_REASONS as readonly string[]).includes(reason)) {
      return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })
    }
    if (details && typeof details === 'string' && details.length > 2000) {
      return NextResponse.json({ error: 'Details too long' }, { status: 400 })
    }

    const listing = await prisma.listing.findUnique({
      where:  { id: listingId },
      select: { id: true, title: true, userId: true, user: { select: { name: true } } },
    })
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
    if (listing.userId === session.id) {
      return NextResponse.json({ error: 'Cannot report your own listing' }, { status: 400 })
    }

    const existing = await prisma.report.findFirst({
      where: { reporterId: session.id, listingId, status: 'pending' },
    })
    if (existing) {
      return NextResponse.json({ error: 'You already have a pending report on this listing' }, { status: 400 })
    }

    const report = await prisma.report.create({
      data: {
        reporterId: session.id,
        reportedId: listing.userId,
        listingId,
        reason,
        details:    typeof details === 'string' ? details.trim() || null : null,
      },
    })

    const staff = await prisma.user.findMany({
      where:  { role: { in: ['admin', 'moderator'] } },
      select: { id: true },
    })
    staff.forEach(s => createNotification(
      s.id,
      'report',
      '🚨 Listing reported',
      `${session.name} flagged "${listing.title}" for ${reason}.`,
      '/admin/reports',
    ).catch(() => {}))

    return NextResponse.json(report, { status: 201 })
  } catch (e) {
    console.error('[listing report]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
