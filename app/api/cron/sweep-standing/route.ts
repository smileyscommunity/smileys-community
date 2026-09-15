import { NextRequest, NextResponse } from 'next/server'
import { recordCronRun } from '@/lib/cronHealth'
import { checkCronAuth } from '@/lib/cronAuth'
import { sweepStanding } from '@/lib/standing'

// Standing sweeper. Hourly via system crontab (scripts/sweep-standing.sh).
// For every event that ended at least a day ago: resolve the RSVPs nobody
// marked as attended, record no-shows and late cancellations, then bring each
// affected member's card up to date — issue, escalate, clear, send for review,
// lapse — and tell members about real cards when standing is switched on.
// Every pass is idempotent (offences are unique per RSVP row, recoveries per
// card and row, cards stamped when notified), so a double run changes nothing.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` (lib/cronAuth; refuses when the
// secret is unconfigured).

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const denied = checkCronAuth(req)
  if (denied) return denied
  try {
    const result = await sweepStanding()
    await recordCronRun('sweep-standing', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-standing]', e)
    await recordCronRun('sweep-standing', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// No GET handler — see sweep-event-surveys for why (secrets in query strings).
