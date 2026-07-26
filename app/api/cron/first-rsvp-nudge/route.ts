import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkCronAuth } from '@/lib/cronAuth'
import { runFirstRsvpNudge } from '@/lib/firstRsvpNudge'
import { sendNudgeReportEmail } from '@/lib/email'

// Weekly first-RSVP nudge. Fired by cron every Wednesday 09:00 UTC (12:00
// Istanbul; server is UTC and Turkey is permanent UTC+3). Emails members who've
// joined but never RSVP'd one matched first-event suggestion. The 30-day
// per-member exclusion inside runFirstRsvpNudge makes a duplicate fire a no-op.
export async function POST(req: NextRequest) {
  const denied = checkCronAuth(req)
  if (denied) return denied

  const result = await runFirstRsvpNudge()
  console.log('[first-rsvp-nudge]', JSON.stringify(result))

  // Self-report to admins so the loop surfaces its own volume + conversion.
  const admins = await prisma.user.findMany({ where: { role: 'admin' }, select: { email: true } })
  await Promise.allSettled(
    admins.filter(a => a.email).map(a => sendNudgeReportEmail(a.email!, result)),
  )

  return NextResponse.json({ ok: true, ...result })
}
