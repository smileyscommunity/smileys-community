import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/rateLimit'
import { runCupResultsSweep } from '@/lib/cup-results-sweep'

// POST /api/admin/cup/results/refresh
//
// Admin-triggered "Refresh suggestions" button on the Fixtures +
// results admin tab. Same sweeper body the system crontab runs
// every 5 minutes; this lets admin force a refresh when a result
// landed mid-cycle and they don't want to wait for the next tick.
//
// Auth via admin session (not CRON_SECRET) — moderators are also
// allowed, matching the rest of the fixtures admin surface. Each
// invocation gets an audit entry so admins can see who manually
// refreshed when (and how often, if it gets spammy).

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Per-admin rate limit. The system crontab already pulls every
  // 5 minutes, so a manual click is for "I don't want to wait the
  // current minute" not "I want to poll." 6/min/admin gives
  // ~one click per 10 seconds with headroom; rapid clicks (or
  // accidental script loops on a compromised admin session) hit
  // 429 before they can exhaust the football-data.org free-tier
  // ceiling of 10 req/min.
  if (!await rateLimit(`cup-results-refresh:${session.id}`, 6, 60_000)) {
    return NextResponse.json({ error: 'Refreshing too fast — slow down' }, { status: 429 })
  }
  if (!process.env.FOOTBALL_DATA_API_KEY) {
    return NextResponse.json({ error: 'FOOTBALL_DATA_API_KEY not configured on server' }, { status: 503 })
  }

  try {
    const result = await runCupResultsSweep()
    writeAudit(session.id, session.name, 'cup.results_refresh', undefined, 'cup_fixture',
      { ...result } as Record<string, unknown>,
      `Refreshed cup results · scanned ${result.matchesScanned}, suggested ${result.suggested}`,
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
