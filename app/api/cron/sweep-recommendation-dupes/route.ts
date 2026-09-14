import { NextRequest, NextResponse } from 'next/server'
import { recordCronRun } from '@/lib/cronHealth'
import { pruneDuplicateRecommendations } from '@/lib/eventRecommendations'

// Nightly duplicate-recommendation prune: one event_recommendations row per
// (member, event), the earliest, with every click/RSVP stamp folded into it
// (see lib/eventRecommendations). Batched and time-boxed so a big backlog
// spreads over several nights instead of holding locks past the curl timeout.
//
// It used to be the last statement of sweep-event-spots, so any failure in
// the spot/club reconciliation ahead of it skipped it silently (logged as an
// event-spots failure), and it only removed unstamped repeats older than a
// week — stamped and recent duplicates were never touched. It runs and
// reports on its own now.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`; 503 when unset.

export const dynamic = 'force-dynamic'

import { checkCronAuth } from '@/lib/cronAuth'

// Leaves headroom under the wrapper's curl --max-time.
const BUDGET_MS = 45_000

export async function POST(req: NextRequest) {
  const denied = await checkCronAuth(req)
  if (denied) return denied

  try {
    const result = await pruneDuplicateRecommendations({ budgetMs: BUDGET_MS })
    if (result.deleted) console.log('[cron sweep-recommendation-dupes]', result)
    await recordCronRun('sweep-recommendation-dupes', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-recommendation-dupes]', e)
    await recordCronRun('sweep-recommendation-dupes', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
