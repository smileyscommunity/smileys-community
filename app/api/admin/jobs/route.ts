import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { SWEEPER_INTERVAL_MIN } from '@/lib/cronHealth'

export const dynamic = 'force-dynamic'

// What the scheduled sweepers have actually been doing.
//
// Every sweeper stamps lib/cronHealth.recordCronRun when it finishes, and the
// admin dashboard already counts the stale ones into a red pill — but there
// was nowhere to go and read WHY one was stale. The pill said "3 sweepers
// stale" and the only way to learn more was to ssh in and read
// /var/log/sweep-*.log. This is that page's data.
//
// Admin-only, not moderators: a sweeper is platform plumbing, its error
// strings quote internal state, and the one runnable job fans reminders out
// to a whole city.

// The jobs an admin may fire by hand from the UI. Deliberately a list of one:
// the rest run on the server's crontab and a manual re-run would either
// double-send (reminders that already went) or fight the schedule. This is
// the block that used to live on the broadcasts page.
const RUNNABLE = [
  {
    name:        'sweep-reminders',
    label:       'Event reminders + review requests',
    description: '24h reminders · 2h reminders · post-event review nudges',
    endpoint:    '/app/api/admin/cron/reminders',
  },
] as const

type JobState = 'ok' | 'stale' | 'never' | 'error'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const names = Object.keys(SWEEPER_INTERVAL_MIN)
  const rows  = await prisma.cronRun.findMany({ where: { name: { in: names } } })
  const byName = new Map(rows.map(r => [r.name, r]))
  const now = Date.now()

  // State is settled here, not in the browser: a client computing "stale"
  // from Date.now() would disagree with the server across a render boundary
  // — the same trap the handbook's review chip documents.
  const jobs = names.map(name => {
    const intervalMin = SWEEPER_INTERVAL_MIN[name]
    const row = byName.get(name)
    const minutesSince = row?.lastSuccessAt
      ? Math.floor((now - row.lastSuccessAt.getTime()) / 60_000)
      : null

    let state: JobState
    if (!row?.lastSuccessAt) state = 'never'
    // The most recent thing that happened was a failure. Distinct from
    // 'stale': a job erroring every five minutes is never stale, and saying
    // "ok" because it ran recently would be the wrong answer twice.
    else if (row.lastErrorAt && row.lastErrorAt > row.lastSuccessAt) state = 'error'
    else if (minutesSince !== null && minutesSince > intervalMin * 2) state = 'stale'
    else state = 'ok'

    return {
      name,
      intervalMin,
      state,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      minutesSince,
      lastError:     row?.lastError ?? null,
      lastErrorAt:   row?.lastErrorAt?.toISOString() ?? null,
      totalRuns:     row?.totalRuns ?? 0,
      totalErrors:   row?.totalErrors ?? 0,
    }
  })

  return NextResponse.json({ jobs, runnable: RUNNABLE })
}
