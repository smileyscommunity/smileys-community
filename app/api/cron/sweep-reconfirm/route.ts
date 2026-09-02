import { NextRequest, NextResponse } from 'next/server'
import { recordCronRun } from '@/lib/cronHealth'
import { checkCronAuth } from '@/lib/cronAuth'
import { sweepReconfirm } from '@/lib/reconfirm'

// Day-before reconfirmation sweeper. Hourly via system crontab
// (scripts/sweep-reconfirm.sh). Asks "still coming?" on free limited-spot
// events inside the ask window, and at the cancellation cutoff releases
// asked-but-unanswered seats to the waitlist when someone is waiting.
// Idempotent: the ask is stamped per attendee row, a released row is no
// longer 'approved'. See lib/reconfirm.ts.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` (lib/cronAuth).

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const denied = checkCronAuth(req)
  if (denied) return denied
  try {
    const result = await sweepReconfirm()
    await recordCronRun('sweep-reconfirm', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-reconfirm]', e)
    await recordCronRun('sweep-reconfirm', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// No GET handler — see sweep-event-surveys for why (secrets in query strings).
