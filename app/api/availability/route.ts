import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'

// Lightweight "I'm around" pulses — the bridge between "I want to meet
// someone" and "I committed to a venue at a time." Surfaces in the
// hangouts feed as a different card type so quiet windows still feel
// alive. See AvailabilityPulse model for the schema rationale.

const MAX_TTL_MS = 4 * 60 * 60 * 1000  // 4 hours — fresh-only signal

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const neighborhood = searchParams.get('neighborhood') || undefined
  const now          = new Date()

  const pulses = await prisma.availabilityPulse.findMany({
    where: {
      until: { gte: now },
      ...(neighborhood ? { neighborhood } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      user: { select: { id: true, name: true, color: true, profilePhoto: true, goodHangouts: true } },
    },
  })

  return NextResponse.json({
    pulses: pulses.map(p => ({
      id:           p.id,
      neighborhood: p.neighborhood,
      note:         p.note,
      until:        p.until,
      createdAt:    p.createdAt,
      user:         p.user,
      isMine:       p.userId === session.id,
    })),
  })
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Looser limit than hangouts since pulses are cheaper signals — but still
    // cap so a script can't farm the feed.
    if (!await rateLimit(`pulse:${session.id}`, 10, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many pulses this hour.' }, { status: 429 })
    }

    const { neighborhood, note, untilMinutes } = await req.json()

    // until is computed server-side from a minutes-from-now value so the
    // client can't smuggle in arbitrary far-future dates. Cap at MAX_TTL_MS.
    const mins = Number(untilMinutes)
    if (!Number.isFinite(mins) || mins < 15 || mins > 240) {
      return NextResponse.json({ error: 'untilMinutes must be 15–240' }, { status: 400 })
    }
    if (note && typeof note === 'string' && note.length > 200) {
      return NextResponse.json({ error: 'Note too long' }, { status: 400 })
    }

    const safeNeighborhood = typeof neighborhood === 'string'
      && (ISTANBUL_NEIGHBORHOODS as readonly string[]).includes(neighborhood)
      ? neighborhood : null

    const until = new Date(Date.now() + mins * 60_000)

    // One active pulse per user — replace any existing one rather than
    // letting users farm the feed with overlapping pings. Cheaper than
    // unique-constraining since active = "until > now", a moving target.
    await prisma.availabilityPulse.deleteMany({
      where: { userId: session.id, until: { gte: new Date() } },
    })

    const created = await prisma.availabilityPulse.create({
      data: {
        userId:       session.id,
        neighborhood: safeNeighborhood,
        note:         typeof note === 'string' ? note.trim().slice(0, 200) || null : null,
        until,
      },
    })

    return NextResponse.json({ id: created.id, until: created.until }, { status: 201 })
  } catch (e) {
    console.error('[availability POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Clear the caller's active pulse(s). No id required — there's only one
  // active pulse per user by construction (see POST).
  await prisma.availabilityPulse.deleteMany({
    where: { userId: session.id, until: { gte: new Date() } },
  })

  return NextResponse.json({ ok: true })
}
