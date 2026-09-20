import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { resolvePostingCityId } from '@/lib/cityMembership'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { restrictedSetFor } from '@/lib/memberPrivacy'
import { firstNameOf } from '@/lib/data'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'

// Everyone the member has blocked or been blocked by. A pulse is a live
// location and a free-text note — the same class of data hangouts already
// hide across a block.
async function blockedWith(userId: string): Promise<string[]> {
  const rows = await prisma.memberBlock.findMany({
    where:  { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  })
  return rows.map(r => (r.blockerId === userId ? r.blockedId : r.blockerId))
}

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

  const blocked = await blockedWith(session.id)
  const pulses = await prisma.availabilityPulse.findMany({
    where: {
      until: { gte: now },
      cityId: await resolveCityId(session),
      ...(blocked.length ? { userId: { notIn: blocked } } : {}),
      ...(neighborhood ? { neighborhood } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      user:  { select: { id: true, name: true, color: true, profilePhoto: true, goodHangouts: true, nationality: true, profileVisibility: true } },
      waves: { select: { userId: true }, orderBy: { createdAt: 'asc' } },
    },
  })

  // Waver names for the poster's "X is free too" line — one batched
  // lookup (PulseWave has no User relation, same pattern as waitlist).
  const waverIds = [...new Set(pulses.flatMap(p => p.waves.map(w => w.userId)))]
  const wavers = waverIds.length
    ? await prisma.user.findMany({ where: { id: { in: waverIds } }, select: { id: true, name: true } })
    : []
  const waverName = new Map(wavers.map(u => [u.id, u.name]))

  // The same rule the rest of the product applies: a connections-only member
  // the viewer isn't connected to is a first name, no photo, and none of the
  // attributes their locked card withholds. The feed sent all of it to the
  // whole city.
  const restricted = await restrictedSetFor(session, pulses.map(p => p.user))

  return NextResponse.json({
    pulses: pulses.map(p => ({
      id:           p.id,
      neighborhood: p.neighborhood,
      note:         p.note,
      until:        p.until,
      createdAt:    p.createdAt,
      user:         {
        id:           p.user.id,
        name:         restricted.has(p.user.id) ? firstNameOf(p.user.name) : p.user.name,
        color:        p.user.color,
        profilePhoto: restricted.has(p.user.id) ? null : p.user.profilePhoto,
        nationality:  restricted.has(p.user.id) ? null : p.user.nationality,
        goodHangouts: p.user.goodHangouts,
      },
      isMine:       p.userId === session.id,
      waves: {
        count: p.waves.length,
        mine:  p.waves.some(w => w.userId === session.id),
        // Who waved is the poster's business — the page only renders these on
        // their own pulse, and sending them for everyone else's put a full
        // name in the payload for every member of the city to read, including
        // wavers whose profile shows a first name. First names either way.
        users: p.userId === session.id
          ? p.waves.slice(0, 5).map(w => ({ id: w.userId, name: firstNameOf(waverName.get(w.userId) ?? 'A member') }))
          : [],
      },
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

    // A pulse belongs to the member's own city, not the one they're browsing —
    // otherwise an Istanbul member looking at İzmir announced themselves to
    // İzmir's locals. Browsed city counts only if they've joined it
    // (resolvePostingCityId). Validation and the fan-out (created.cityId) use
    // the same city.
    const postingCityId = await resolvePostingCityId(session)
    const safeNeighborhood = await safeNeighborhoodFor(postingCityId, neighborhood)

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
        cityId:       postingCityId,
        neighborhood: safeNeighborhood,
        note:         typeof note === 'string' ? note.trim().slice(0, 200) || null : null,
        until,
      },
    })

    // Fire-and-forget fan-out. A neighborhood pulse pings every approved
    // member LIVING there — not just connections. The connections-only
    // fan-out reached nobody in practice (sparse connection graph → zero
    // notifications ever sent), which killed the feature's loop. A pulse
    // with no neighborhood still goes to accepted connections only. Each
    // send is gated by the newEvents pref + quiet hours inside
    // createNotification, so muted members don't get pulse pings. Doesn't
    // block the 201.
    //
    // Anti-spam: the neighborhood audience can be hundreds of members, and
    // re-posting a pulse replaces the old one — without a guard, 10
    // pulses/hour × a big neighborhood = a notification cannon. One
    // fan-out per poster per 3h; extra pulses still post, just silently.
    const canFanOut = await rateLimit(`pulse-fanout:${session.id}`, 1, 3 * 60 * 60_000)
    if (canFanOut) (async () => {
      try {
        let audience: string[]
        if (safeNeighborhood) {
          // The poster's city: neighborhood names repeat across cities, and a
          // bare name pinged same-named neighborhoods everywhere.
          const locals = await prisma.user.findMany({
            where:  { status: 'approved', neighborhood: safeNeighborhood, cityId: created.cityId, id: { not: session.id } },
            select: { id: true },
          })
          audience = locals.map(u => u.id)
        } else {
          const conns = await prisma.memberConnection.findMany({
            where:  { status: 'accepted', OR: [{ requesterId: session.id }, { receiverId: session.id }] },
            select: { requesterId: true, receiverId: true },
          })
          audience = [...new Set(conns.map(c => c.requesterId === session.id ? c.receiverId : c.requesterId))]
            .filter(uid => uid !== session.id)
        }
        const blockedIds = new Set(await blockedWith(session.id))
        audience = audience.filter(uid => !blockedIds.has(uid))
        if (audience.length === 0) return

        const title = safeNeighborhood ? '🟢 A neighbor is free to meet' : '🟢 A connection is free to meet'
        // A connections-only member is a first name to everyone they aren't
        // connected to — their profile, the directory and the visitor board
        // all hold that line. This pushed their full name to every
        // unconnected person living in the neighbourhood.
        const me = await prisma.user.findUnique({
          where: { id: session.id }, select: { profileVisibility: true },
        })
        let connectedIds = new Set<string>()
        if (me?.profileVisibility === 'connections') {
          const conns = await prisma.memberConnection.findMany({
            where:  { status: 'accepted', OR: [{ requesterId: session.id }, { receiverId: session.id }] },
            select: { requesterId: true, receiverId: true },
          })
          connectedIds = new Set(conns.map(c => (c.requesterId === session.id ? c.receiverId : c.requesterId)))
        }
        const shownName = (uid: string) =>
          me?.profileVisibility === 'connections' && !connectedIds.has(uid) ? firstNameOf(session.name) : session.name
        for (const uid of audience) {
          const body = `${shownName(uid)} is around${safeNeighborhood ? ` in ${safeNeighborhood}` : ''}${created.note ? ` — ${created.note}` : ''}`
          createNotification(uid, 'availability_pulse', title, body, '/hangouts').catch(() => {})
        }
      } catch (e) {
        console.error('[pulse fanout]', e)
      }
    })()

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
