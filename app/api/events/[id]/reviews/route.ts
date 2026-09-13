import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { trackServer } from '@/lib/posthog-server'
import { todayInCity } from '@/lib/city'
import { rateLimit } from '@/lib/rateLimit'
import { Attendance } from '@/lib/constants'
import { CardStatus } from '@/lib/noShowPolicy'

// Bodies are untyped JSON: rating "3" or 4.5 reached Prisma's Int column and
// 500'd, text: 123 threw on .trim, and PATCH rating "abc" slipped past a
// numeric comparison. Validated here, once, for both writes.
const validRating = (r: unknown): r is number => Number.isInteger(r) && (r as number) >= 1 && (r as number) <= 5
const REVIEW_WRITES_PER_HOUR = 20

type Params = { params: Promise<{ id: string }> }

export async function GET(_: NextRequest, { params }: Params) {
  try {
    // Member-only: only past attendees can review, so the reviewer list is a
    // de-facto attendance list — don't expose it to unauthenticated callers.
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: eventId } = await params
    const reviews = await prisma.review.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { name: true, color: true } },
      },
    })
    return NextResponse.json(reviews)
  } catch (e) {
    console.error('[reviews GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`review-write:${session.id}`, REVIEW_WRITES_PER_HOUR, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id: eventId } = await params
    const { rating, text } = await req.json().catch(() => ({}))

    if (!validRating(rating)) {
      return NextResponse.json({ error: 'Rating must be 1–5' }, { status: 400 })
    }
    if (text != null && typeof text !== 'string') {
      return NextResponse.json({ error: 'Review text must be text' }, { status: 400 })
    }
    if (text && text.trim().length > 1000) {
      return NextResponse.json({ error: 'Review text too long (max 1000 chars)' }, { status: 400 })
    }

    const event = await prisma.event.findUnique({ where: { id: eventId } })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    // The event's city decides when it is over — the viewer's view-city
    // cookie could be a day ahead (or behind) of it.
    const today = await todayInCity(event.cityId)
    if (event.date >= today) {
      return NextResponse.json({ error: 'You can only review past events' }, { status: 400 })
    }

    const attended = await prisma.eventAttendee.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    // A settled no-show keeps status 'approved' (lib/attendance), so status
    // alone let someone who never came review the night. A no-show whose card
    // was later cleared did come — the host waived it ("was there, the scanner
    // missed them") or an admin overturned it. The attendee row keeps its
    // no_show mark as the trail (lib/noShow waiveCard), so the card decides.
    let noShow = attended?.attendance === Attendance.NoShow
    if (attended && noShow) {
      const cleared = await prisma.noShowCard.findFirst({
        where:  { attendeeId: attended.id, status: { in: [CardStatus.Waived, CardStatus.Overturned] } },
        select: { id: true },
      })
      if (cleared) noShow = false
    }
    if (!attended || attended.status !== 'approved' || noShow) {
      return NextResponse.json({ error: 'You must have attended this event to review it' }, { status: 403 })
    }

    const existing = await prisma.review.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (existing) return NextResponse.json({ error: 'You already reviewed this event' }, { status: 400 })

    const review = await prisma.review.create({
      data: { userId: session.id, eventId, rating, text: text?.trim() ?? '' },
      include: { user: { select: { id: true, name: true, color: true } } },
    })

    trackServer(session, 'event_review_submitted', {
      event_id: eventId,
      rating,
      has_text: !!(text?.trim()),
    })

    return NextResponse.json(review)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`review-write:${session.id}`, REVIEW_WRITES_PER_HOUR, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id: eventId } = await params
    const { rating, text } = await req.json().catch(() => ({}))

    if (rating !== undefined && !validRating(rating)) {
      return NextResponse.json({ error: 'Rating must be 1–5' }, { status: 400 })
    }
    if (text !== undefined && typeof text !== 'string') {
      return NextResponse.json({ error: 'Review text must be text' }, { status: 400 })
    }
    if (text && text.trim().length > 1000) {
      return NextResponse.json({ error: 'Review text too long (max 1000 chars)' }, { status: 400 })
    }

    const review = await prisma.review.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 })

    const updated = await prisma.review.update({
      where: { id: review.id },
      data: {
        ...(rating !== undefined && { rating }),
        ...(text !== undefined && { text: text.trim() }),
      },
      include: { user: { select: { id: true, name: true, color: true } } },
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[reviews PATCH]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`review-write:${session.id}`, REVIEW_WRITES_PER_HOUR, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id: eventId } = await params

    const review = await prisma.review.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 })

    await prisma.review.delete({ where: { id: review.id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[reviews DELETE]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
