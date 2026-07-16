import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { recordCronRun } from '@/lib/cronHealth'
import { todayIstanbul } from '@/lib/data'

// Sweeper that closes the waitlist lifecycle. Without this cron, a member
// who queued for a full event and never won a freed spot stays on that
// waitlist forever after the event passes — stale rows in the DB, a
// confusing "still waiting" state on their side, and phantom entries on
// the admin per-event page (found via Selin A., 2026-07-11).
//
// One pass per call:
//   - Find waitlist entries whose event date is before Istanbul-today.
//   - Events that actually happened (not cancelled/postponed) → send the
//     member a warm close-out nudging them to the events list. Cancelled/
//     postponed events delete silently — those members already got the
//     cancellation notice, a "filled up" note would be wrong.
//   - Delete the entries. Idempotency comes for free: deleted rows can't
//     be picked up again. Notify-then-delete, so a crash mid-flight
//     retries on the next run (worst case: duplicate note — acceptable).
//
// Auth: `Authorization: Bearer <CRON_SECRET>` via lib/cronAuth
// (constant-time comparison; refuses when the secret is unconfigured).

export const dynamic = 'force-dynamic'

import { checkCronAuth } from '@/lib/cronAuth'

export async function POST(req: NextRequest) {
  const denied = await checkCronAuth(req)
  if (denied) return denied

  try {
    const today = todayIstanbul()

    // WaitlistEntry has no FK relations (bare userId/eventId columns), so
    // events are batch-fetched separately — same pattern as the admin
    // participants API.
    const entries = await prisma.waitlistEntry.findMany({
      select: { id: true, userId: true, eventId: true },
    })
    const eventIds = [...new Set(entries.map(e => e.eventId))]
    const events = eventIds.length
      ? await prisma.event.findMany({
          where:  { id: { in: eventIds }, date: { lt: today } },
          select: { id: true, title: true, emoji: true, status: true, date: true },
        })
      : []
    const pastEvent = new Map(events.map(e => [e.id, e]))
    const stale = entries.filter(e => pastEvent.has(e.eventId))

    // Only close out RECENT misses — a "came and went" note about an event
    // from weeks ago (the pre-sweeper backlog) reads as noise. Older
    // entries purge silently.
    const noteCutoff = todayIstanbul(-7)

    let notified = 0
    for (const entry of stale) {
      const event = pastEvent.get(entry.eventId)!
      // Cancelled/postponed events already told their people — only send
      // the "filled up" close-out when the event genuinely ran full.
      if (event.status !== 'cancelled' && event.status !== 'postponed' && event.date >= noteCutoff) {
        await createNotification(
          entry.userId,
          'waitlist',
          'That one filled up 💛',
          `"${event.title}" came and went before a spot opened. New events go live every week — grab your seat early!`,
          '/events',
        ).catch(() => {})
        notified++
      }
    }

    const { count: deleted } = stale.length
      ? await prisma.waitlistEntry.deleteMany({ where: { id: { in: stale.map(e => e.id) } } })
      : { count: 0 }

    await recordCronRun('sweep-waitlists', true)
    return NextResponse.json({ ok: true, deleted, notified })
  } catch (e) {
    console.error('[sweep-waitlists]', e)
    await recordCronRun('sweep-waitlists', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
