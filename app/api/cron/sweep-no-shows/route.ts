import { NextRequest, NextResponse } from 'next/server'
import { recordCronRun } from '@/lib/cronHealth'
import { checkCronAuth } from '@/lib/cronAuth'
import { sweepNoShows } from '@/lib/noShow'

// No-show settlement sweeper. Hourly via system crontab (scripts/
// sweep-no-shows.sh). For every event that ended at least
// NO_SHOW_PROCESSING_DELAY_HOURS ago and hasn't been settled: mark the
// no-shows, issue yellow/red cards on free events, then tell the members,
// start any red-card blocks whose appeal window has closed, and expire what
// has run its course. Every pass is idempotent on its own stamp
// (events.noShowProcessedAt, cards.notifiedAt / restrictionNotifiedAt), so a
// double run — or a crash and retry — never doubles a card or an email.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` (lib/cronAuth; refuses when the
// secret is unconfigured).

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const denied = checkCronAuth(req)
  if (denied) return denied
  try {
    const result = await sweepNoShows()
    await recordCronRun('sweep-no-shows', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-no-shows]', e)
    await recordCronRun('sweep-no-shows', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// No GET handler — see sweep-event-surveys for why (secrets in query strings).
