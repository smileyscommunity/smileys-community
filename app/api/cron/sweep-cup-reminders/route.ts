import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/push'
import { teamLabel } from '@/lib/cup-data'

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

  for (const fx of fixtures) {
    // TBD fixtures (knockout slots before the prior round resolves)
    // have no teams yet. Stamp them so the cron doesn't reconsider
    // them every 5 min until T-25 passes; no actual push is sent.
    if (!fx.homeTeam || !fx.awayTeam) {
      await prisma.cupFixture.update({
        where: { id: fx.id },
        data:  { reminderSentAt: new Date() },
      })
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
      // Nobody to ping. Still stamp so we skip this row next run.
      await prisma.cupFixture.update({
        where: { id: fx.id },
        data:  { reminderSentAt: new Date() },
      })
      continue
    }

    const title = `⚽ ${teamLabel(fx.homeTeam)} vs ${teamLabel(fx.awayTeam)}`
    const body  = 'Kicks off in 30 min — lock your pick'
    const link  = '/app/cup'

    // sendPushToUser handles per-subscription error recovery (stale
    // 404/410 endpoints get cleaned up automatically). Promise.all
    // — we want one stamp per fixture, after all sends settle.
    await Promise.allSettled(
      candidates.map(u => sendPushToUser(u.id, { title, body, link })),
    )

    await prisma.cupFixture.update({
      where: { id: fx.id },
      data:  { reminderSentAt: new Date() },
    })

    totalSent      += candidates.length
    fixturesPushed += 1
  }

  return {
    fixturesScanned:  fixtures.length,
    fixturesPushed,
    fixturesSkippedTbd: skipped.length,
    pushesSent:       totalSent,
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req)
  if (auth) return auth
  try {
    const result = await runSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
