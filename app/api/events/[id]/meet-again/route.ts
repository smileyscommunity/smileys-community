import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { trackServer } from '@/lib/posthog-server'
import { blockedIdsFor, connectionIdsFor } from '@/lib/memberPrivacy'
import { firstNameOf } from '@/lib/data'
import {
  MEET_AGAIN_MAX_PICKS, meetAgainRoom, meetAgainWindow, resolveMutualPick,
} from '@/lib/meetAgain'

type Params = { params: Promise<{ id: string }> }

// "Would you meet them again?" — see lib/meetAgain for the rules.
//
// GET  → whether the viewer can pick, and who from: the room minus self,
//        blocks either way and people already connected, by FIRST NAME and
//        photo — what the event page's roster shows (it renders firstNameOf
//        for attendees and hosts alike; a connections-only member's surname
//        is private). It carries the viewer's OWN picks and nothing about
//        anyone else's, and no event details: an ineligible viewer learns
//        nothing, not even the title of an event they can't see.
// POST → { pickedIds } replaces the viewer's picks for this event, then
//        connects any pair that is now mutual.

// Events that happened. A postponed event keeps its approved RSVPs and a
// null cancelledAt (attendance-claim), so cancelledAt alone let people
// "meet again" at a meeting that never took place.
const HAPPENED = ['published', 'archived']

async function loadEvent(id: string) {
  const event = await prisma.event.findUnique({
    where:  { id },
    select: {
      id: true, title: true, date: true, time: true, endTime: true,
      hostId: true, status: true, cancelledAt: true, city: { select: { timezone: true } },
    },
  })
  return event && !event.cancelledAt && HAPPENED.includes(event.status) ? event : null
}

export async function GET(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const event = await loadEvent(id)
  // Same answer for a missing event, one that never happened, not being on
  // it, and being on it in stealth: none of them is something to confirm.
  if (!event) return NextResponse.json({ eligible: false })
  const room = await meetAgainRoom(event.id, event.hostId)
  if (!room.has(session.id)) return NextResponse.json({ eligible: false })

  const closed = meetAgainWindow(event, event.city?.timezone)
  if (closed) return NextResponse.json({ eligible: false, reason: closed })

  const [blocked, connected, mine] = await Promise.all([
    blockedIdsFor(session.id),
    connectionIdsFor(session.id),
    prisma.eventMeetAgain.findMany({
      where:  { eventId: event.id, pickerId: session.id },
      select: { pickedId: true },
    }),
  ])

  const candidateIds = [...room].filter(uid => uid !== session.id && !blocked.has(uid) && !connected.has(uid))
  const people = candidateIds.length
    ? (await prisma.user.findMany({
        where:   { id: { in: candidateIds } },
        select:  { id: true, name: true, color: true, profilePhoto: true },
        orderBy: { name: 'asc' },
      })).map(u => ({ ...u, name: firstNameOf(u.name) }))
    : []

  return NextResponse.json({
    eligible: true,
    people,
    // Only picks that are still on the list.
    picked: mine.map(m => m.pickedId).filter(uid => candidateIds.includes(uid)),
    maxPicks: MEET_AGAIN_MAX_PICKS,
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await rateLimit(`meet-again:${session.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  if (!Array.isArray(body.pickedIds) || !body.pickedIds.every((x: unknown) => typeof x === 'string')) {
    return NextResponse.json({ error: 'pickedIds must be a list' }, { status: 400 })
  }
  const requested = [...new Set(body.pickedIds as string[])]
  if (requested.length > MEET_AGAIN_MAX_PICKS) {
    return NextResponse.json({ error: `Pick up to ${MEET_AGAIN_MAX_PICKS} people` }, { status: 400 })
  }

  const { id } = await params
  const event = await loadEvent(id)
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const room = await meetAgainRoom(event.id, event.hostId)
  if (!room.has(session.id)) return NextResponse.json({ error: 'You were not at this event' }, { status: 403 })
  const closed = meetAgainWindow(event, event.city?.timezone)
  if (closed === 'too-early')     return NextResponse.json({ error: "The event hasn't ended yet" }, { status: 400 })
  if (closed === 'window-closed') return NextResponse.json({ error: 'This closed 7 days after the event' }, { status: 400 })

  // Everyone picked must have been in the same room — a stranger's id is
  // refused, so a probing client learns nothing it couldn't read off the
  // roster.
  if (requested.some(uid => uid === session.id || !room.has(uid))) {
    return NextResponse.json({ error: 'You can only pick people who were there' }, { status: 400 })
  }
  // Blocked (either way) and already-connected ids are dropped SILENTLY. The
  // roster doesn't filter blocks, so a distinct refusal here told a member
  // that someone on it had blocked them. A stored pick on a connection would
  // sit dormant and spring back after any later unfriend.
  const [blocked, connected] = await Promise.all([blockedIdsFor(session.id), connectionIdsFor(session.id)])
  const pickedIds = requested.filter(uid => !blocked.has(uid) && !connected.has(uid))

  // Own picks first, then the reverse lookup — the ordering is what makes
  // two simultaneous submits safe (lib/meetAgain resolveMutualPick).
  await prisma.$transaction([
    prisma.eventMeetAgain.deleteMany({
      where: { eventId: event.id, pickerId: session.id, pickedId: { notIn: pickedIds } },
    }),
    prisma.eventMeetAgain.createMany({
      data: pickedIds.map(pickedId => ({ eventId: event.id, pickerId: session.id, pickedId })),
      skipDuplicates: true,
    }),
  ])

  const reverse = pickedIds.length
    ? await prisma.eventMeetAgain.findMany({
        where:  { eventId: event.id, pickerId: { in: pickedIds }, pickedId: session.id },
        select: { picker: { select: { id: true, name: true } } },
      })
    : []

  let matches = 0
  for (const r of reverse) {
    if (await resolveMutualPick(event.id, event.title, { id: session.id, name: session.name }, r.picker)) matches++
  }

  trackServer(session, 'meet_again_submitted', { event_id: event.id, picks: pickedIds.length, matches })

  // The response says how many NEW connections this submit made and nothing
  // else — never which picks are still waiting on the other side.
  return NextResponse.json({ ok: true, matches })
}
