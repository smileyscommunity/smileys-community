import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cronAuth'
import { runFirstRsvpNudge } from '@/lib/firstRsvpNudge'

// Weekly first-RSVP nudge. Fired by cron every Wednesday 09:00 UTC (12:00
// Istanbul; server is UTC and Turkey is permanent UTC+3). Emails members who've
// joined but never RSVP'd one matched first-event suggestion. The 30-day
// per-member exclusion inside runFirstRsvpNudge makes a duplicate fire a no-op.
export async function POST(req: NextRequest) {
  const denied = checkCronAuth(req)
  if (denied) return denied

  const result = await runFirstRsvpNudge()
  console.log('[first-rsvp-nudge]', JSON.stringify(result))
  return NextResponse.json({ ok: true, ...result })
}
