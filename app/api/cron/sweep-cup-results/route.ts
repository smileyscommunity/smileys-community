import { NextRequest, NextResponse } from 'next/server'
import { runCupResultsSweep } from '@/lib/cup-results-sweep'
import { recordCronRun } from '@/lib/cronHealth'

// Cup auto-score sweeper — system-crontab entry. Calls the shared
// runCupResultsSweep() body (see lib/cup-results-sweep.ts) which
// the admin "Refresh suggestions" button also invokes. Keeping the
// body in lib means both callers stay perfectly in sync.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`. Refuses
// with 503 if CRON_SECRET isn't configured. Also refuses with
// 503 if FOOTBALL_DATA_API_KEY isn't set so a freshly-deployed
// box without the key doesn't silently 500 on every cron tick.

export const dynamic = 'force-dynamic'

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured on server' }, { status: 503 })
  }
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (got !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.FOOTBALL_DATA_API_KEY) {
    return NextResponse.json({ error: 'FOOTBALL_DATA_API_KEY not configured on server' }, { status: 503 })
  }
  return null
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req)
  if (auth) return auth
  try {
    const result = await runCupResultsSweep()
    await recordCronRun('sweep-cup-results', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    await recordCronRun('sweep-cup-results', false, e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
