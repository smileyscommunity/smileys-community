import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/rateLimit'
import { UserStatus } from '@/lib/constants'
import { isAdmin } from '@/lib/access'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { lockEventRow, seatState, seatVerdict, overCapacityBody, wantsOverCapacity } from '@/lib/eventCapacity'
import { getMemberCityIds } from '@/lib/cityMembership'
import { isBlockedEitherWay } from '@/lib/memberPrivacy'

async function canManage(session: { id: string; role: string } | null, eventId: string) {
  if (!session) return false
  if (session.role === 'admin') return true
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { hostId: true } })
  return event?.hostId === session.id
}

// Every add notifies the member, so add/remove on a loop was a way to spam
// someone's bell. One budget across both verbs, per session.
const COHOST_LIMIT = 30
const COHOST_WINDOW_MS = 10 * 60_000

// userId went straight into Prisma: a number or object threw a validation
// error, an unknown id a P2003 — both unhandled 500s. The body comes back too:
// a remove reads its allowOverCapacity from it.
async function readBody(req: NextRequest): Promise<{ userId: string | null; body: unknown }> {
  const body = await req.json().catch(() => null)
  const userId = body && typeof body === 'object' ? (body as { userId?: unknown }).userId : undefined
  return { userId: typeof userId === 'string' && userId.trim() ? userId : null, body }
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    const { id } = await params
    if (!await canManage(session, id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const cohosts = await prisma.eventCoHost.findMany({
      where: { eventId: id },
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
      orderBy: { addedAt: 'asc' },
    })
    return NextResponse.json(cohosts)
  } catch (e) {
    console.error('[cohosts GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    const { id } = await params
    if (!session || !await canManage(session, id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!await rateLimit(`cohosts:${session.id}`, COHOST_LIMIT, COHOST_WINDOW_MS)) {
      return NextResponse.json({ error: 'Too many co-host changes — try again in a few minutes' }, { status: 429 })
    }

    const { userId } = await readBody(req)
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const event = await prisma.event.findUnique({ where: { id }, select: { title: true, hostId: true, totalSpots: true, cityId: true } })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.hostId === userId) return NextResponse.json({ error: 'Already the main host' }, { status: 400 })

    // A co-host runs the door and sees the event chat — only a real, approved
    // member qualifies (pending applicants and suspended accounts don't).
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, status: true, suspendedUntil: true, hiddenFromMembers: true, cityId: true } })
    if (!user) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (user.status !== UserStatus.Approved || (user.suspendedUntil && user.suspendedUntil > new Date())) {
      return NextResponse.json({ error: 'Only active members can be co-hosts' }, { status: 400 })
    }
    // Door powers go to someone the host could reach anyway: a member of the
    // event's city, not hidden, and not in a block with the host. Staff pick
    // anyone.
    if (!isAdmin(session)) {
      const cities = await getMemberCityIds(userId)
      if (user.hiddenFromMembers || await isBlockedEitherWay(session.id, userId) ||
          (user.cityId !== event.cityId && !cities.includes(event.cityId))) {
        return NextResponse.json({ error: 'That member can\'t co-host this event' }, { status: 400 })
      }
    }

    const cohost = await prisma.eventCoHost.upsert({
      where: { eventId_userId: { eventId: id, userId } },
      create: { eventId: id, userId },
      update: {},
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
    })
    // A co-host takes no seat (lib/spotsLeft), so an attendee made co-host
    // frees one — and one removed as co-host takes one back. The counter the
    // RSVP gate reads was left as it was, and a stale-high one seated a member
    // past the cap.
    await recomputeSpotsLeft(id, event.totalSpots).catch(err =>
      console.error('[cohosts POST] spotsLeft recompute failed', { eventId: id, err: String(err) }))

    await createNotification(
      userId,
      'host_assigned',
      `You've been added as co-host`,
      `You've been added as a co-host for "${event.title}".`,
      `/events/${id}`,
    )

    // Removes were audited, adds weren't — half the story of who could run an event.
    writeAudit(session.id, session.name, 'event.cohost_add', userId, 'user',
      { eventId: id, eventTitle: event.title, userName: user.name },
      `Added ${user.name ?? userId} as co-host of "${event.title}"`,
    )

    return NextResponse.json(cohost)
  } catch (e) {
    console.error('[cohosts POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    const { id } = await params
    if (!session || !await canManage(session, id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!await rateLimit(`cohosts:${session.id}`, COHOST_LIMIT, COHOST_WINDOW_MS)) {
      return NextResponse.json({ error: 'Too many co-host changes — try again in a few minutes' }, { status: 429 })
    }

    const { userId, body } = await readBody(req)
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const [user, event] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.event.findUnique({ where: { id }, select: { title: true, hostId: true } }),
    ])
    // See POST: a co-host holding an approved seat starts counting the moment
    // they stop being staff. On a full limited event that seated one past the
    // cap with nobody asked — so the removal follows every other staff seat
    // door (lib/eventCapacity): counted, refused unless confirmed, and written
    // with the counter re-derived under the row lock the RSVP route takes.
    const outcome = await prisma.$transaction(async tx => {
      if (!event) {
        await tx.eventCoHost.deleteMany({ where: { eventId: id, userId } })
        return { ok: true as const }
      }
      await lockEventRow(tx, id)
      const seats = await seatState(tx, id)
      const seatStartsCounting = !!seats && seats.limited && userId !== event.hostId && seats.staffIds.includes(userId)
        && await tx.eventAttendee.count({ where: { eventId: id, userId, status: 'approved' } }) > 0
      if (seats && seatStartsCounting && !wantsOverCapacity(body)) {
        const verdict = seatVerdict(seats)
        if (!verdict.ok) return verdict
      }
      await tx.eventCoHost.deleteMany({ where: { eventId: id, userId } })
      if (seats) await recomputeSpotsLeft(id, seats.totalSpots, tx)
      return { ok: true as const }
    })
    if (!outcome.ok) {
      return NextResponse.json({
        ...overCapacityBody(outcome),
        error: `${user?.name ?? 'This member'} holds a seat, which counts once they're no longer a co-host — and this event is full (${outcome.approved} of ${outcome.totalSpots} seats taken). Confirm to keep their seat over capacity.`,
      }, { status: 409 })
    }
    writeAudit(session.id, session.name, 'event.cohost_remove', userId, 'user',
      { eventId: id, eventTitle: event?.title, userName: user?.name },
      `Removed ${user?.name ?? userId} as co-host of "${event?.title ?? id}"`,
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[cohosts DELETE]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
