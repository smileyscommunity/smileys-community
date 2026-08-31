import { prisma } from '@/lib/prisma'

// #5 monitoring: each cron sweeper calls recordCronRun at the
// end of its handler to stamp lastSuccessAt or lastError. The
// dashboard alert in /admin/page.tsx counts sweepers whose
// lastSuccessAt is older than 2× their expected cadence and
// surfaces a red pill so silent cron failures don't go
// un-noticed.
//
// Failure to persist the run record is logged but never thrown
// — sweepers should fail loudly on their actual work, not on
// the bookkeeping.

export async function recordCronRun(name: string, success: boolean, error?: unknown): Promise<void> {
  try {
    const errMsg = error instanceof Error ? error.message : error ? String(error) : null
    await prisma.cronRun.upsert({
      where:  { name },
      create: {
        name,
        lastSuccessAt: success ? new Date() : null,
        lastError:     success ? null : (errMsg ?? '(no error message)').slice(0, 500),
        lastErrorAt:   success ? null : new Date(),
        totalRuns:     1,
        totalErrors:   success ? 0 : 1,
      },
      update: success
        ? { lastSuccessAt: new Date(), totalRuns: { increment: 1 } }
        : {
          lastError:   (errMsg ?? '(no error message)').slice(0, 500),
          lastErrorAt: new Date(),
          totalRuns:   { increment: 1 },
          totalErrors: { increment: 1 },
        },
    })
  } catch (recordErr) {
    console.error('[recordCronRun] failed to persist run record', { name, recordErr: String(recordErr) })
  }
}

// Expected cadence per sweeper, in minutes. Used by the
// staleness check on the admin dashboard — a sweeper is
// considered stale if its lastSuccessAt is older than
// 2× its expected interval.
//
// Keep this in sync with the crontab entries in
// scripts/sweep-*.sh and the install logic in deploy.sh.
export const SWEEPER_INTERVAL_MIN: Record<string, number> = {
  // sweep-cup-reminders / sweep-cup-results retired 2026-07-27 with the
  // Cup (deploy.sh removes their crontab lines) — listing them here made
  // the staleness check cry wolf forever. Re-add for the next tournament.
  //
  // Deliberately unmonitored (no HTTP route, so nothing calls
  // recordCronRun — they run tsx/pg_dump directly from their shell
  // scripts and surface via /var/log/<name>.log + emailed reports):
  //   db-backup, sweep-connection-abuse, sweep-neighborhood-hygiene.
  'sweep-newsletters':      5,
  'sweep-event-surveys':    60,
  'sweep-hangouts':         60,
  'sweep-payment-reminders': 60,
  'sweep-reminders':        60,
  'sweep-nps':              24 * 60,
  'sweep-event-spots':      24 * 60,
  'sweep-waitlists':        24 * 60,
  'sweep-availability-pulses': 24 * 60,
  'sweep-login-nudge':      24 * 60,
  'sweep-name-hygiene':     24 * 60,
  'sweep-review-nudges':    7 * 24 * 60,
  'sweep-first-rsvp-nudge': 7 * 24 * 60,
}

// Returns names of sweepers whose lastSuccessAt is missing OR
// older than 2× their expected cadence. Cheap query — single
// findMany over a tiny table.
export async function listStaleSweepers(): Promise<{ name: string; lastSuccessAt: Date | null; minutesSince: number | null }[]> {
  const rows = await prisma.cronRun.findMany({
    where:  { name: { in: Object.keys(SWEEPER_INTERVAL_MIN) } },
    select: { name: true, lastSuccessAt: true },
  })
  const byName = new Map(rows.map(r => [r.name, r]))
  const now = Date.now()
  const stale: { name: string; lastSuccessAt: Date | null; minutesSince: number | null }[] = []
  for (const [name, intervalMin] of Object.entries(SWEEPER_INTERVAL_MIN)) {
    const row = byName.get(name)
    if (!row || !row.lastSuccessAt) {
      // Never recorded a success — could mean newly deployed
      // and hasn't fired yet, or could mean it's been broken
      // since day 1. Surface either way so admin can confirm.
      stale.push({ name, lastSuccessAt: null, minutesSince: null })
      continue
    }
    const minutesSince = Math.floor((now - row.lastSuccessAt.getTime()) / 60_000)
    if (minutesSince > intervalMin * 2) {
      stale.push({ name, lastSuccessAt: row.lastSuccessAt, minutesSince })
    }
  }
  return stale
}
