import { prisma } from './prisma'

/**
 * Is staff's LATEST word on this event "live"?
 *
 * It used to ask whether staff had EVER published it — so after a moderator
 * flagged a live event over a complaint, the host moved it to draft and
 * published it again, and the takedown was undone with no moderator. Now the
 * most recent staff decision wins: a flag, unpublish or send-back-to-review
 * after the publish closes the door again.
 *
 * Publication is a staff decision (the event PUT route blocks a host moving an
 * unpublished event into 'published'), but that made Draft/Postponed a one-way
 * door: a host who parked their own live event could not bring it back without
 * a moderator. A host may reopen a door staff already opened — this answers
 * whether staff ever opened it.
 *
 * There is no publish timestamp on Event, so the signal is the audit trail:
 *   - `event.published`  — the moderator PATCH (admin/moderator only) that
 *     approves a pending event or flips an unpublished one live.
 *   - `event.update` whose diff moved status INTO 'published' — a staff edit
 *     through the full form. A host cannot produce this row: their own
 *     transition into published is gated on this very function, and a no-op
 *     resubmit of an already-published status produces no diff.
 *
 * Fails CLOSED: an event that predates the audit log, or one created live by
 * staff (the create route writes no audit row), reads as "never published by
 * staff" and still needs a moderator. Wrongly refusing a republish costs a
 * message to staff; wrongly allowing one puts an unreviewed event in front of
 * the whole city.
 */
// The moderator PATCH writes `event.<status>`; these take an event down.
const STAFF_TAKEDOWNS = ['event.flagged', 'event.unpublished', 'event.pending'] as const

export async function wasStaffPublished(eventId: string): Promise<boolean> {
  try {
    const rows = await prisma.auditLog.findMany({
      where:   { targetType: 'event', targetId: eventId, action: { in: [...STAFF_TAKEDOWNS, 'event.published', 'event.update'] } },
      select:  { action: true, meta: true },
      orderBy: { createdAt: 'desc' },
      take:    100,
    })
    // Newest first: the first staff decision found is the one that stands.
    for (const r of rows) {
      if ((STAFF_TAKEDOWNS as readonly string[]).includes(r.action)) return false
      if (r.action === 'event.published' || publishedInDiff(r.meta)) return true
    }
    return false
  } catch (e) {
    // An audit lookup that fails must not hand out a publish.
    console.error('[wasStaffPublished] audit lookup failed', { eventId, err: String(e) })
    return false
  }
}

/** meta.diff.status.to === 'published', walked defensively (meta is free-form Json). */
function publishedInDiff(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false
  const diff = (meta as { diff?: unknown }).diff
  if (!diff || typeof diff !== 'object') return false
  const status = (diff as { status?: unknown }).status
  if (!status || typeof status !== 'object') return false
  return (status as { to?: unknown }).to === 'published'
}
