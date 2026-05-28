import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'

// Sweeper that closes the hangout lifecycle. Without this cron, hangouts
// silently vanish from the feed when endsAt passes — no recap, no analytics,
// no "starting soon" push. Runs every 15 min via system crontab; see
// scripts/sweep-hangouts.sh.
//
// Two passes per call:
//   1. STARTING SOON — hangouts where startsAt is within the next 30 min and
//      we haven't pinged yet (notifiedStartingAt IS NULL). Push host +
//      joiners, then stamp notifiedStartingAt so the next sweeper run skips.
//   2. EXPIRED — hangouts whose endsAt has passed and status is still
//      'active'. Push host + joiners a recap, then flip status to 'expired'.
//      Idempotency comes for free: once status flips, this query won't pick
//      it up again.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is
// unset, the endpoint refuses with 503 so a misconfigured prod doesn't
// silently leave the sweeper open to the internet.

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
  const now              = new Date()
  const thirtyMinFromNow = new Date(now.getTime() + 30 * 60 * 1000)

  // ── Pass 1: starting-soon pings ─────────────────────────────────────────
  // Window: [now, now + 30min]. Cron runs every 15 min, so a hangout
  // starting in 25 min gets pinged on this pass and won't be re-pinged
  // because notifiedStartingAt is set.
  const startingSoon = await prisma.hangout.findMany({
    where: {
      status:             'active',
      notifiedStartingAt: null,
      startsAt:           { gte: now, lte: thirtyMinFromNow },
    },
    include: {
      user:  { select: { id: true, name: true } },
      joins: { select: { userId: true } },
    },
  })

  let startingCount = 0
  for (const h of startingSoon) {
    const joinerCount = h.joins.length

    // Host gets a "your hangout is happening — here's who's coming" ping so
    // they're not surprised by arrivals.
    createNotification(
      h.userId,
      'hangout_starting',
      `🚀 Your hangout starts in 30 min`,
      joinerCount > 0
        ? `${h.title} — ${joinerCount} joiner${joinerCount === 1 ? '' : 's'} confirmed`
        : `${h.title} — no joiners yet, but you might still meet someone`,
      `/hangouts`,
    ).catch(() => {})

    // Each joiner gets a "leave now" nudge. This is the single highest-value
    // notification of the whole hangouts feature — if joiners don't show, the
    // host's commitment was wasted.
    for (const j of h.joins) {
      createNotification(
        j.userId,
        'hangout_starting',
        `⏰ Hangout starts in 30 min`,
        `${h.title} — ${h.location}`,
        `/hangouts`,
      ).catch(() => {})
    }

    await prisma.hangout.update({
      where: { id: h.id },
      data:  { notifiedStartingAt: now },
    })
    startingCount++
  }

  // ── Pass 2: expire + recap ──────────────────────────────────────────────
  // Pick anything that ended but is still 'active'. We flip status AFTER
  // sending the pushes so a crash mid-flight leaves the hangout to be
  // retried on the next sweep (worst case: duplicate pushes — acceptable).
  const expired = await prisma.hangout.findMany({
    where: {
      status: 'active',
      endsAt: { lt: now },
    },
    include: {
      user:  { select: { id: true, name: true } },
      joins: { select: { userId: true } },
    },
  })

  let expiredCount = 0
  for (const h of expired) {
    const joinerCount = h.joins.length

    // Host recap — closes the loop and primes the "leave a reference" surface
    // once the references feature ships (see hangouts roadmap).
    createNotification(
      h.userId,
      'hangout_recap',
      `✓ Your hangout ended`,
      joinerCount > 0
        ? `${h.title} — ${joinerCount} joiner${joinerCount === 1 ? '' : 's'} — hope it was good!`
        : `${h.title} ended with no joiners — try again with a different time?`,
      `/hangouts`,
    ).catch(() => {})

    // Joiner recap — same closing-ritual purpose. Skips silent disappearance.
    for (const j of h.joins) {
      createNotification(
        j.userId,
        'hangout_recap',
        `✓ Hangout ended`,
        `${h.title} with ${h.user.name} — hope it was good!`,
        `/hangouts`,
      ).catch(() => {})
    }

    await prisma.hangout.update({
      where: { id: h.id },
      data:  { status: 'expired' },
    })
    expiredCount++
  }

  return { now: now.toISOString(), startingCount, expiredCount }
}

export async function POST(req: NextRequest) {
  const denied = await authorize(req)
  if (denied) return denied

  try {
    const result = await runSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-hangouts]', e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// GET allowed for easy manual testing from a browser when CRON_SECRET is
// passed as ?key=. Keeps prod debugging painless without exposing anything
// the POST doesn't.
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
    console.error('[cron sweep-hangouts]', e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
