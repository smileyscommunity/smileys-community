import { NextResponse } from 'next/server'
import { listStaleSweepers } from '@/lib/cronHealth'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

// Public cron-health probe for external monitoring (the weekly health-check
// routine can't hold an admin session). Exposes only sweeper NAMES and
// staleness minutes — both already public in the repo — never run errors,
// counts, or anything member-derived. The full picture stays on the
// admin-gated stats route.
export async function GET(req: NextRequest) {
  if (!await rateLimit(`health-crons:${getIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  try {
    const stale = await listStaleSweepers()
    return NextResponse.json({
      ok: stale.length === 0,
      staleSweepers: stale.map(s => ({ name: s.name, minutesSince: s.minutesSince })),
    }, { status: stale.length === 0 ? 200 : 503 })
  } catch {
    return NextResponse.json({ ok: false, error: 'check failed' }, { status: 503 })
  }
}
