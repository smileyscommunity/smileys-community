import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { todayIstanbul } from '@/lib/data'

type Params = { params: Promise<{ id: string }> }

export async function GET(_: NextRequest, { params }: Params) {
  try {
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
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    const { id: eventId } = await params
    const { rating, text } = await req.json()

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be 1–5' }, { status: 400 })
    }
    if (text && text.trim().length > 1000) {
      return NextResponse.json({ error: 'Review text too long (max 1000 chars)' }, { status: 400 })
    }

    const event = await prisma.event.findUnique({ where: { id: eventId } })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    const today = todayIstanbul()
    if (event.date >= today) {
      return NextResponse.json({ error: 'You can only review past events' }, { status: 400 })
    }

    const attended = await prisma.eventAttendee.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (!attended || attended.status !== 'approved') {
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

    const { id: eventId } = await params
    const { rating, text } = await req.json()

    if (rating !== undefined && (rating < 1 || rating > 5)) {
      return NextResponse.json({ error: 'Rating must be 1–5' }, { status: 400 })
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
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    const { id: eventId } = await params

    const review = await prisma.review.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 })

    await prisma.review.delete({ where: { id: review.id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
