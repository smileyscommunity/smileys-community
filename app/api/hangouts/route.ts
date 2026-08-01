import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
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
    include: {
      // goodHangouts surfaces as a "✓ N good hangouts" badge next to the
      // host name on each card. languages drives the "Speaks my language"
      // filter — overlap with caller's languages is computed client-side
      // so we don't have to denormalize a derived field.
      user:  { select: { id: true, name: true, color: true, profilePhoto: true, goodHangouts: true, languages: true, nationality: true } },
      joins: {
        select: { userId: true, user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
        orderBy: { createdAt: 'asc' },
      },
      _count: { select: { messages: true } },
    },
  })

  // Mutual-connections per host — the friend-of-friend trust signal. Two
  // queries: (1) caller's friend IDs, (2) host↔friend edges. Cheap because
  // both are indexed on (requesterId|receiverId).
  const hostIds = [...new Set(hangouts.map(h => h.userId).filter(id => id !== session.id))]
  const mutualsByHost: Record<string, number> = {}
  if (hostIds.length > 0) {
    const myConns = await prisma.memberConnection.findMany({
      where:  { status: 'accepted', OR: [{ requesterId: session.id }, { receiverId: session.id }] },
      select: { requesterId: true, receiverId: true },
    })
    const myFriendIds = new Set<string>()
    for (const c of myConns) {
      if (c.requesterId !== session.id) myFriendIds.add(c.requesterId)
      if (c.receiverId  !== session.id) myFriendIds.add(c.receiverId)
    }

    if (myFriendIds.size > 0) {
      const friendArr = [...myFriendIds]
      const hostConns = await prisma.memberConnection.findMany({
        where: {
          status: 'accepted',
          OR: [
            { requesterId: { in: hostIds   }, receiverId: { in: friendArr } },
            { receiverId:  { in: hostIds   }, requesterId: { in: friendArr } },
          ],
        },
        select: { requesterId: true, receiverId: true },
      })
      const hostSet = new Set(hostIds)
      for (const c of hostConns) {
        const hostId = hostSet.has(c.requesterId) ? c.requesterId : c.receiverId
        mutualsByHost[hostId] = (mutualsByHost[hostId] ?? 0) + 1
      }
    }
  }

  // Shape into something the client can render directly — joinedByMe is a
  // boolean instead of forcing the client to scan the joins array.
  const shaped = hangouts.map(h => ({
    id:           h.id,
    title:        h.title,
    description:  h.description,
    location:     h.location,
    neighborhood: h.neighborhood,
    startsAt:     h.startsAt,
    endsAt:       h.endsAt,
    status:       h.status,
    meetMode:     h.meetMode,
    photo:        h.photo,
    user:         {
      ...h.user,
      // Number of caller's friends who are also friends with this host.
      // Zero is normal for new members — only render the badge when > 0.
      mutualConnections: mutualsByHost[h.userId] ?? 0,
    },
    joiners:      h.joins.map(j => j.user),
    joinedByMe:   h.joins.some(j => j.userId === session.id),
    messageCount: h._count.messages,
  }))

  return NextResponse.json({ hangouts: shaped })
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`hangout:${session.id}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many hangouts this hour. Take a breath.' }, { status: 429 })
    }

    const { title, description, location, neighborhood, startsAt, endsAt, meetMode, photo } = await req.json()

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
    if (endDate.getTime() - startDate.getTime() > 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: 'Max 24 hours per hangout' }, { status: 400 })
    }
    if (endDate < new Date()) {
      return NextResponse.json({ error: 'End is in the past' }, { status: 400 })
    }

    const safeNeighborhood = typeof neighborhood === 'string'
      && (ISTANBUL_NEIGHBORHOODS as readonly string[]).includes(neighborhood)
      ? neighborhood : null

    // meetMode: tighten to the two allowed values. Anything else falls back
    // to 'group' so a misbehaving client can't poison the DB with arbitrary
    // strings (we filter on this in the feed).
    const safeMeetMode = meetMode === 'solo' ? 'solo' : 'group'

    // photo: must be a string matching the upload-output URL pattern. Same
    // regex as DM image attachments — prevents a malicious client from
    // smuggling a remote URL through this field.
    const PHOTO_URL_RE = /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/
    const safePhoto = typeof photo === 'string' && PHOTO_URL_RE.test(photo) ? photo : null

    const created = await prisma.hangout.create({
      data: {
        userId:       session.id,
        title:        title.trim().slice(0, 120),
        description:  typeof description === 'string' ? description.trim().slice(0, 500) || null : null,
        location:     location.trim().slice(0, 200),
        neighborhood: safeNeighborhood,
        startsAt:     startDate,
        endsAt:       endDate,
        meetMode:     safeMeetMode,
        photo:        safePhoto,
      },
    })

    // Notify nearby members — the entire value-prop is "someone shows up,"
    // so reach is everything. Skip city-wide broadcast when no neighborhood
    // is set, but otherwise we want the audience to include:
    //   (a) members whose home neighborhood matches the hangout
    //   (b) members who've previously joined a hangout in this neighborhood
    //       — they've signaled interest in the area with their feet
    // Union the two, dedupe, exclude the host. createNotification gives every
    // recipient an inbox row AND a push, so missed-push users still see it.
    ;(async () => {
      try {
        const audience = new Set<string>()

        // Always reach the host's accepted connections — a friend starting a
        // hangout is worth a ping wherever it is (previously this was only a
        // fallback when no neighborhood was set, so connections missed
        // neighborhood-tagged hangouts).
        const conns = await prisma.memberConnection.findMany({
          where:  { status: 'accepted', OR: [{ requesterId: session.id }, { receiverId: session.id }] },
          select: { requesterId: true, receiverId: true },
        })
        for (const c of conns) {
          audience.add(c.requesterId === session.id ? c.receiverId : c.requesterId)
        }

        // Plus, when the hangout names a neighborhood, the locals there and
        // people who've joined hangouts there before ("would be interested
        // again").
        if (safeNeighborhood) {
          const [locals, pastJoiners] = await Promise.all([
            prisma.user.findMany({
              where:  { neighborhood: safeNeighborhood, status: 'approved', id: { not: session.id } },
              select: { id: true },
            }),
            prisma.hangoutJoin.findMany({
              where:    {
                hangout:  { neighborhood: safeNeighborhood },
                userId:   { not: session.id },
                user:     { status: 'approved' },
              },
              select:   { userId: true },
              distinct: ['userId'],
            }),
          ])
          for (const u of locals)      audience.add(u.id)
          for (const j of pastJoiners) audience.add(j.userId)
        }

        audience.delete(session.id)
        const heading = safeNeighborhood ? `☕ Hangout in ${safeNeighborhood}` : `☕ ${created.title}`
        for (const userId of audience) {
          createNotification(
            userId,
            'new_hangout',
            heading,
            `${created.title} — ${created.location}`,
            `/hangouts`,
          ).catch(() => {})
        }
      } catch (e) {
        console.error('[hangout fanout]', e)
      }
    })()

    return NextResponse.json({ id: created.id }, { status: 201 })
  } catch (e) {
    console.error('[hangouts POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
