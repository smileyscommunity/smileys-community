import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { sendPushToUser } from '@/lib/push'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'

// Members-only — hangouts are real-time, contact-required, and we don't want
// random scrapers seeing "someone alone at this cafe in 30 min."

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const neighborhood = searchParams.get('neighborhood') || undefined
  const now = new Date()

  const hangouts = await prisma.hangout.findMany({
    where: {
      status: 'active',
      endsAt: { gte: now },
      ...(neighborhood ? { neighborhood } : {}),
    },
    orderBy: { startsAt: 'asc' },
    take: 100,
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })

  return NextResponse.json({ hangouts })
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`hangout:${session.id}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many hangouts this hour. Take a breath.' }, { status: 429 })
    }

    const { title, description, location, neighborhood, startsAt, endsAt } = await req.json()

    if (!title?.trim() || !location?.trim() || !startsAt || !endsAt) {
      return NextResponse.json({ error: 'Title, location, and times are required' }, { status: 400 })
    }
    if (title.length > 120 || location.length > 200) {
      return NextResponse.json({ error: 'Title or location too long' }, { status: 400 })
    }
    if (description && description.length > 500) {
      return NextResponse.json({ error: 'Description too long' }, { status: 400 })
    }

    const startDate = new Date(startsAt)
    const endDate   = new Date(endsAt)
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }
    if (endDate <= startDate) {
      return NextResponse.json({ error: 'End must be after start' }, { status: 400 })
    }
    // Cap window so people don't post 24h hangouts that clutter the feed.
    if (endDate.getTime() - startDate.getTime() > 12 * 60 * 60 * 1000) {
      return NextResponse.json({ error: 'Max 12 hours per hangout' }, { status: 400 })
    }
    if (endDate < new Date()) {
      return NextResponse.json({ error: 'End is in the past' }, { status: 400 })
    }

    const safeNeighborhood = typeof neighborhood === 'string'
      && (ISTANBUL_NEIGHBORHOODS as readonly string[]).includes(neighborhood)
      ? neighborhood : null

    const created = await prisma.hangout.create({
      data: {
        userId:       session.id,
        title:        title.trim().slice(0, 120),
        description:  typeof description === 'string' ? description.trim().slice(0, 500) || null : null,
        location:     location.trim().slice(0, 200),
        neighborhood: safeNeighborhood,
        startsAt:     startDate,
        endsAt:       endDate,
      },
    })

    // Push nearby members — the entire value-prop is "someone shows up." Skip
    // if no neighborhood; we don't want to broadcast a hangout city-wide.
    if (safeNeighborhood) {
      prisma.user.findMany({
        where:  { neighborhood: safeNeighborhood, status: 'approved', id: { not: session.id } },
        select: { id: true },
      }).then(locals => {
        for (const u of locals) {
          sendPushToUser(u.id, {
            title: `☕ Hangout in ${safeNeighborhood}`,
            body:  `${created.title} — ${created.location}`,
            link:  `/hangouts`,
          }).catch(() => {})
        }
      }).catch(() => {})
    }

    return NextResponse.json({ id: created.id }, { status: 201 })
  } catch (e) {
    console.error('[hangouts POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
