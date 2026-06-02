import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/push'
import { teamLabel } from '@/lib/cup-data'
import { recordCronRun } from '@/lib/cronHealth'

// Cup match-reminder sweeper. Fires every 5 minutes from system
// crontab on the prod box; finds fixtures whose kickoff is ~30
// minutes away and pushes "lock your pick" to subscribed members
// who haven't picked the fixture yet.
//
// Window logic: each run looks at kickoffAt in [now+25min, now+35min].
// With a 5-min cadence that catches every fixture exactly once
// during its T-30 window without overlap. Once a fixture's reminder
// has fired (reminderSentAt stamped), subsequent runs skip it.
//
// Targeting: we only push to users who (a) have a push subscription,
// (b) are status='approved', and (c) haven't picked the fixture yet.
// A user who already locked their pick doesn't need a reminder —
// the whole point is the unlock-before-kickoff nudge.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`. Refuses
// with 503 if CRON_SECRET isn't configured so a misconfigured prod
// can't silently expose the endpoint.

export const dynamic = 'force-dynamic'

// Constant-time secret check — see lib/cronAuth.ts.
import { checkCronAuth } from '@/lib/cronAuth'

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const fail = checkCronAuth(req)
  if (fail) return fail
  return null
}

// Push fan-out batch size. Web Push providers (Apple/FCM/etc.) handle
// large bursts well, but issuing 1000 simultaneous sendNotification
// calls makes timeouts murky and ties up the Node event loop. 50 is a
// pragmatic ceiling — keeps each batch under a second on a healthy
// link without serializing the cron tail.
const PUSH_BATCH_SIZE = 50

async function runSweep() {
  const now     = new Date()
  // [T-35, T-25] — every kickoff lands in this 10-min window
  // exactly once given a 5-min cron cadence.
  const lower   = new Date(now.getTime() + 25 * 60 * 1000)
  const upper   = new Date(now.getTime() + 35 * 60 * 1000)

  const fixtures = await prisma.cupFixture.findMany({
    where: {
      reminderSentAt: null,
      kickoffAt:      { gte: lower, lte: upper },
    },
    select: { id: true, homeTeam: true, awayTeam: true, round: true, kickoffAt: true },
  })

  let totalSent      = 0
  let fixturesPushed = 0
  const skipped: string[] = []
  let claimMissed    = 0

  for (const fx of fixtures) {
    // Atomically CLAIM the fixture by stamping reminderSentAt before
    // we do any work. updateMany with the same `reminderSentAt: null`
    // predicate means a concurrent runSweep that already claimed
    // this row sees `count: 0` here — exactly one worker proceeds,
    // the others skip silently. Without this guard, an overlapping
    // run (slow batch, request retry) could re-send the same push
    // round to every subscriber.
    const claim = await prisma.cupFixture.updateMany({
      where: { id: fx.id, reminderSentAt: null },
      data:  { reminderSentAt: new Date() },
    })
    if (claim.count !== 1) {
      claimMissed += 1
      continue
    }

    // TBD fixtures (knockout slots before the prior round resolves)
    // have no teams yet. The claim above already stamped, so the
    // cron won't reconsider them every 5 min; no push is sent.
    if (!fx.homeTeam || !fx.awayTeam) {
      skipped.push(fx.id)
      continue
    }

    // Approved members with at least one push subscription AND no
    // prediction yet for this fixture. Picked-already members get
    // nothing — quieter is better. status='approved' matches the
    // gate the rest of the cup APIs use.
    const candidates = await prisma.user.findMany({
      where: {
        status:            'approved',
        pushSubscriptions: { some: {} },
        cupPredictions:    { none:  { fixtureId: fx.id } },
      },
      select: { id: true },
    })

    if (candidates.length === 0) {
      // Nobody to ping — claim already stamped, nothing to do.
      continue
    }

    const title = `⚽ ${teamLabel(fx.homeTeam)} vs ${teamLabel(fx.awayTeam)}`
    const body  = 'Kicks off in 30 min — lock your pick'
    const link  = '/app/cup'

    // Batched fan-out: chunks of PUSH_BATCH_SIZE in parallel,
    // sequential between chunks. sendPushToUser handles per-
    // subscription error recovery (stale 404/410 endpoints get
    // cleaned up automatically). The claim already stamped, so a
    // crash partway through means some subscribers miss this one
    // reminder — but they won't get double-sent on retry either.
    for (let i = 0; i < candidates.length; i += PUSH_BATCH_SIZE) {
      const batch = candidates.slice(i, i + PUSH_BATCH_SIZE)
      await Promise.allSettled(
        batch.map(u => sendPushToUser(u.id, { title, body, link })),
      )
    }

    totalSent      += candidates.length
    fixturesPushed += 1
  }

  return {
    fixturesScanned:  fixtures.length,
    fixturesPushed,
    fixturesSkippedTbd: skipped.length,
    fixturesClaimMissed: claimMissed,
    pushesSent:       totalSent,
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req)
  if (auth) return auth
  try {
    const result = await runSweep()
    await recordCronRun('sweep-cup-reminders', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    await recordCronRun('sweep-cup-reminders', false, e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
