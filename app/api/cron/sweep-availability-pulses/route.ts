import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { recordCronRun } from '@/lib/cronHealth'
import { checkCronAuth } from '@/lib/cronAuth'

// Nightly sweeper: hard-delete AvailabilityPulse rows whose `until` timestamp
// expired more than 48 hours ago. Without this, stale pulses accumulate forever
// because the only thing that moves a pulse out of the live feed is the
// client-side `until > now` filter — the rows themselves never go away.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`.

export const dynamic = 'force-dynamic'

async function runSweep() {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)

  const { count } = await prisma.availabilityPulse.deleteMany({
    where: { until: { lt: cutoff } },
  })

  return { deletedCount: count, cutoff: cutoff.toISOString() }
}

export async function POST(req: NextRequest) {
  const denied = await checkCronAuth(req)
  if (denied) return denied

  try {
    const result = await runSweep()
    await recordCronRun('sweep-availability-pulses', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-availability-pulses]', e)
    await recordCronRun('sweep-availability-pulses', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// No GET handler: the old "?key=<CRON_SECRET>" browser-testing path put
// the secret in query strings (nginx access logs, browser history) — the
// same class as the 2026-08 DB-password-in-crontab incident. Test with:
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" <url>
