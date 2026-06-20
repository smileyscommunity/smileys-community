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

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured on server' }, { status: 503 })
  }
  const key = req.nextUrl.searchParams.get('key') ?? ''
  const a = Buffer.from(key)
  const b = Buffer.from(expected)
  const { timingSafeEqual } = await import('crypto')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-availability-pulses]', e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
