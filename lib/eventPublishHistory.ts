import { prisma } from './prisma'

/**
 * Was this event ever put live by STAFF?
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
export async function wasStaffPublished(eventId: string): Promise<boolean> {
  try {
    const rows = await prisma.auditLog.findMany({
      where:   { targetType: 'event', targetId: eventId, action: { in: ['event.published', 'event.update'] } },
      select:  { action: true, meta: true },
      orderBy: { createdAt: 'desc' },
      take:    100,
    })
    return rows.some(r => r.action === 'event.published' || publishedInDiff(r.meta))
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
