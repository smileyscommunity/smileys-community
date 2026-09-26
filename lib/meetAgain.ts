import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'
import { firstNameOf } from '@/lib/data'
import { eventEndsAt } from '@/lib/eventTime'
import { DEFAULT_TZ } from '@/lib/cityTime'

// "Would you meet them again?" — after an event, each person in the room
// privately ticks who they'd like to see again. A pick is never shown to
// anyone. When two people pick each other, they become connected and both
// are told; nothing else is ever revealed (no "3 people picked you").
//
// The room is the survey's eligible pool (sweep-event-surveys) widened to
// the host and co-hosts — often the person someone most wants to see again —
// and narrowed to what the event page's roster already shows members:
// stealth RSVPs and admin-hidden accounts stay out, so the list can't name
// anyone the roster doesn't.

export const MEET_AGAIN_MAX_PICKS = 8
export const MEET_AGAIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type MeetAgainClosed = 'too-early' | 'window-closed'

/** Open between the event's end and seven days after it, on the city's clock. */
export function meetAgainWindow(
  event: { date: string; time: string | null; endTime: string | null },
  tz: string | null | undefined,
  now: number = Date.now(),
): MeetAgainClosed | null {
  const endedAt = eventEndsAt(event, tz ?? DEFAULT_TZ).getTime()
  if (now < endedAt) return 'too-early'
  if (now > endedAt + MEET_AGAIN_WINDOW_MS) return 'window-closed'
  return null
}

/**
 * Everyone who counts as having been in the room: approved attendees who
 * weren't settled as no-shows or excused, plus the host and co-hosts. Stealth
 * attendees and hidden accounts are left out entirely — they can't be listed,
 * so their picks could never be returned and the step isn't offered to them.
 * Only approved accounts: a banned or suspended member is nobody's pick.
 */
export async function meetAgainRoom(eventId: string, hostId: string | null): Promise<Set<string>> {
  const [attendees, cohosts] = await Promise.all([
    prisma.eventAttendee.findMany({
      where: {
        eventId,
        status:  'approved',
        stealth: false,
        user:    { status: 'approved', hiddenFromMembers: false },
        NOT: [
          { attendance: 'no_show', event: { noShowProcessedAt: { not: null } } },
          { attendance: 'excused' },
        ],
      },
      select: { userId: true },
    }),
    prisma.eventCoHost.findMany({
      where:  { eventId, user: { status: 'approved', hiddenFromMembers: false } },
      select: { userId: true },
    }),
  ])
  const room = new Set<string>([...attendees.map(a => a.userId), ...cohosts.map(c => c.userId)])
  if (hostId) {
    const host = await prisma.user.findFirst({
      where:  { id: hostId, status: 'approved', hiddenFromMembers: false },
      select: { id: true },
    })
    if (host) room.add(host.id)
  }
  return room
}

export function pairKeyOf(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** Picks either way between two members — on one event, or on any. */
export function pairPicksWhere(a: string, b: string, eventId?: string) {
  return {
    ...(eventId ? { eventId } : {}),
    OR: [{ pickerId: a, pickedId: b }, { pickerId: b, pickedId: a }],
  }
}

async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  return !!(await prisma.memberBlock.findFirst({
    where:  { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    select: { id: true },
  }))
}

// Audit actor for the one write here that overrides a member's earlier
// choice. adminId is a plain string (no FK), same as SCRIPT_ACTOR.
const MEET_AGAIN_ACTOR = { id: 'system:meet-again', name: 'Meet again' } as const
const NOTIFY_CLAIM_MS  = 30 * 24 * 60 * 60 * 1000

/**
 * Both picked each other: make them connected. Returns true when this call
 * turned the pair into a connection (and so notified them).
 *
 * Safe to run from both sides at once — each submit writes its own picks
 * BEFORE looking for the reverse one, so at least one of two simultaneous
 * submits sees the match; pairKey's unique index keeps it to one row.
 *
 * A pick is spent by the match: both rows are deleted once the connection
 * exists. Left in place, they outlived an unfriend — the other side re-POSTed
 * inside the window, found the old reverse pick and silently re-created the
 * connection the member had just removed, repeatably.
 *
 * An existing row in any state becomes 'accepted'. That includes a quiet
 * decline: the decline memory exists to stop a requester nagging, and here
 * the person who declined has just picked the other one themselves. The
 * decline is what the connection-abuse scan counts, so overriding it is
 * audited rather than lost.
 */
export async function resolveMutualPick(
  eventId: string,
  eventTitle: string,
  a: { id: string; name: string },
  b: { id: string; name: string },
): Promise<boolean> {
  if (await blockedEitherWay(a.id, b.id)) return false

  const pairKey  = pairKeyOf(a.id, b.id)
  const existing = await prisma.memberConnection.findUnique({
    where:  { pairKey },
    select: { id: true, status: true, requesterId: true, receiverId: true },
  })
  if (existing?.status === 'accepted') return false

  let connectionId: string
  if (existing) {
    // Conditional on the status just read, so a concurrent resolve that got
    // there first leaves this one a no-op instead of a second announcement.
    const flipped = await prisma.memberConnection.updateMany({
      where: { id: existing.id, status: existing.status },
      data:  { status: 'accepted' },
    })
    if (flipped.count === 0) return false
    connectionId = existing.id
    if (existing.status === 'declined') {
      await writeAudit(MEET_AGAIN_ACTOR.id, MEET_AGAIN_ACTOR.name, 'connection.decline_overridden',
        existing.requesterId, 'user',
        { eventId, requesterId: existing.requesterId, declinedBy: existing.receiverId, connectionId: existing.id },
        'A declined connection request became a connection after both picked each other at an event')
    }
  } else {
    try {
      const created = await prisma.memberConnection.create({
        data:   { requesterId: a.id, receiverId: b.id, pairKey, status: 'accepted' },
        select: { id: true },
      })
      connectionId = created.id
    } catch (e: unknown) {
      // P2002: the other side's submit created it a moment ago.
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002') return false
      throw e
    }
  }

  // A block that landed between the check above and the write: the block
  // route's own sweep may already have run, so undo it here.
  if (await blockedEitherWay(a.id, b.id)) {
    await prisma.memberConnection.deleteMany({ where: { id: connectionId, status: 'accepted' } })
    return false
  }

  await prisma.eventMeetAgain.deleteMany({ where: pairPicksWhere(a.id, b.id, eventId) })

  // One claim per recipient per event, handed back if the write fails so a
  // retry can still tell them. Keyed on the event, not the pair alone: a
  // genuine later re-match (after an unfriend) must be announced too.
  await Promise.all([[a, b], [b, a]].map(async ([to, other]) => {
    const key = `meet-again-match:${eventId}:${pairKey}:${to.id}`
    if (!await claimOnce(key, NOTIFY_CLAIM_MS)) return
    const sent = await createNotification(to.id, 'connection_accepted',
      `You and ${firstNameOf(other.name)} both want to meet again`,
      `You met at ${eventTitle}. You're now connected.`,
      `/members/${other.id}`)
    if (!sent) await releaseClaim(key)
  }))
  return true
}
