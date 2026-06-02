import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { periodFor, periodStartDate, eligibilityCutoff } from '@/lib/nps'
import { recordCronRun } from '@/lib/cronHealth'

// Quarterly NPS dispatch sweeper. Sends the nudge notification to
// approved members who:
//
//   1. Joined ≥ 30 days ago (so they've had real exposure)
//   2. Have not yet responded for the current period
//   3. Have not yet received this quarter's nudge
//
// Idempotency: condition (3) is enforced by checking the Notification
// table for a row with type='nps_survey' AND reference URL containing
// the period string. Re-runs of the sweeper therefore skip already-
// nudged users, and a transient failure on user N doesn't block user
// N+1 because each notification fire is independent.
//
// Window: dispatches only within the first 14 days of each quarter,
// so a daily cron is cheap (no-op the rest of the time). The 14d
// window gives latecomers a chance — anyone whose joinedAt crosses
// the 30d cutoff after Day 1 still gets nudged within their first
// eligible quarter.
//
// Runs daily via system crontab (see scripts/sweep-nps-dispatch.sh).
// Auth: requires `Authorization: Bearer <CRON_SECRET>`. If
// CRON_SECRET is unset the endpoint refuses with 503 so a
// misconfigured prod doesn't leave the dispatcher open.

export const dynamic = 'force-dynamic'

const DISPATCH_WINDOW_DAYS = 14
const BATCH_SIZE           = 500  // safety cap per run — daily cadence handles the rest

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on server' },
      { status: 503 },
    )
  }
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (got !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

async function runSweep() {
  const now      = new Date()
  const period   = periodFor(now)
  const start    = periodStartDate(period)
  const elapsed  = (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)

  // Outside the dispatch window — daily ping costs almost nothing,
  // but bail early so we don't scan the user table needlessly.
  if (elapsed < 0 || elapsed > DISPATCH_WINDOW_DAYS) {
    return { now: now.toISOString(), period, dispatched: 0, skipped: 'outside-window', elapsedDays: Math.round(elapsed) }
  }

  const joinedCutoff = eligibilityCutoff(now)

  // Candidate pool — approved members who are old enough. We pull
  // ids only and filter "already responded / already nudged" in a
  // second pass so the candidate query stays index-friendly.
  const candidates = await prisma.user.findMany({
    where: {
      status:   'approved',
      joinedAt: { lt: joinedCutoff },
    },
    select: { id: true },
    take:   BATCH_SIZE * 10,  // headroom — filtered down before notifying
  })

  if (candidates.length === 0) {
    return { now: now.toISOString(), period, dispatched: 0 }
  }
  const candidateIds = candidates.map(c => c.id)

  // Bulk-fetch (a) who has already responded this period, (b) who
  // has already been nudged. Two queries instead of one-per-user.
  const [responded, nudged] = await Promise.all([
    prisma.memberNPS.findMany({
      where:  { period, userId: { in: candidateIds } },
      select: { userId: true },
    }),
    // Notifications for nps_survey, this quarter, to one of these
    // users. The link is /survey/nps?period=YYYY-Qn so the LIKE is
    // anchored to the period string — that way last quarter's nudge
    // doesn't suppress this quarter's.
    prisma.notification.findMany({
      where: {
        type:   'nps_survey',
        userId: { in: candidateIds },
        link:   { contains: period },
      },
      select: { userId: true },
    }),
  ])
  const respondedSet = new Set(responded.map(r => r.userId))
  const nudgedSet    = new Set(nudged.map(n    => n.userId))

  const targets = candidateIds
    .filter(uid => !respondedSet.has(uid) && !nudgedSet.has(uid))
    .slice(0, BATCH_SIZE)

  let dispatched = 0
  for (const userId of targets) {
    try {
      await createNotification(
        userId,
        'nps_survey',
        '💛 Quick quarterly check-in',
        'One question, anonymous. Takes 10 seconds.',
        `/survey/nps?period=${period}`,
      )
      dispatched++
    } catch (e) {
      console.error('[cron sweep-nps] notify failed', userId, e)
    }
  }

  return { now: now.toISOString(), period, dispatched, eligiblePool: targets.length, elapsedDays: Math.round(elapsed) }
}

export async function POST(req: NextRequest) {
  const denied = await authorize(req)
  if (denied) return denied
  try {
    const result = await runSweep()
    await recordCronRun('sweep-nps', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-nps]', e)
    await recordCronRun('sweep-nps', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// GET allowed for easy manual testing in a browser.
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on server' },
      { status: 503 },
    )
  }
  const key = req.nextUrl.searchParams.get('key')
  if (key !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-nps]', e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
