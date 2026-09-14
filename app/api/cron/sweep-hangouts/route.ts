import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { recordCronRun } from '@/lib/cronHealth'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'

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

// Cron secret check delegated to lib/cronAuth.ts so the comparison is
// constant-time (timingSafeEqual) instead of `!==`. See that file for
// the rationale.
import { checkCronAuth } from '@/lib/cronAuth'

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  return checkCronAuth(req)
}

const CLAIM_WINDOW_MS = 2 * 24 * 60 * 60 * 1000
const LOCK_MS         = 10 * 60 * 1000
// A hangout whose recap keeps failing for someone is still retired after
// this long — an 'active' row past its end must not live on forever.
const RECAP_RETRY_MS  = 24 * 60 * 60 * 1000

// The stamp (notifiedStartingAt / status) is written only after the sends,
// so two overlapping runs — or a retry of a run that died mid-loop — read the
// same hangout and both pushed everyone. A per-recipient claim, like the
// reminders/no-show/reconfirm sweeps take, lets exactly one of them send; a
// write that failed hands its claim back so the next run retries just that
// person instead of losing them for the window.
async function notifyOnce(key: string, userId: string, type: string, title: string, body: string, link: string): Promise<'sent' | 'skipped' | 'failed'> {
  if (!await claimOnce(key, CLAIM_WINDOW_MS)) return 'skipped'
  if (await createNotification(userId, type, title, body, link)) return 'sent'
  await releaseClaim(key)
  return 'failed'
}

// One run works a hangout at a time. Recipient claims alone let an
// overlapping run find everyone "already claimed" and stamp the hangout
// while the other run's send was failing — and the stamp ends the retry.
// Released when done; a run that crashes lets it lapse after LOCK_MS.
async function withLock(key: string, work: () => Promise<void>): Promise<void> {
  if (!await claimOnce(key, LOCK_MS)) return
  try { await work() } finally { await releaseClaim(key) }
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
  for (const h of startingSoon) await withLock(`hangout-starting-run:${h.id}`, async () => {
    const joinerCount = h.joins.length
    // Keyed on startsAt too: a moved start clears notifiedStartingAt to
    // re-arm the ping, and the claim for the old time must not swallow it.
    const keyFor = (userId: string) => `hangout-starting:${h.id}:${h.startsAt.getTime()}:${userId}`
    let failed = false

    // Host gets a "your hangout is happening — here's who's coming" ping so
    // they're not surprised by arrivals.
    if (await notifyOnce(
      keyFor(h.userId),
      h.userId,
      'hangout_starting',
      `🚀 Your hangout starts in 30 min`,
      joinerCount > 0
        ? `${h.title} — ${joinerCount} joiner${joinerCount === 1 ? '' : 's'} confirmed`
        : `${h.title} — no joiners yet, but you might still meet someone`,
      `/hangouts`,
    ) === 'failed') failed = true

    // Each joiner gets a "leave now" nudge. This is the single highest-value
    // notification of the whole hangouts feature — if joiners don't show, the
    // host's commitment was wasted.
    for (const j of h.joins) {
      if (await notifyOnce(
        keyFor(j.userId),
        j.userId,
        'hangout_starting',
        `⏰ Hangout starts in 30 min`,
        `${h.title} — ${h.location}`,
        `/hangouts`,
      ) === 'failed') failed = true
    }

    // A failed send leaves the hangout unstamped so the next run (still
    // inside the 30-min window) retries it; the claims keep everyone who
    // already got the ping from getting it again.
    if (failed) return
    await prisma.hangout.update({
      where: { id: h.id },
      data:  { notifiedStartingAt: now },
    })
    startingCount++
  })

  // ── Pass 2: expire + recap ──────────────────────────────────────────────
  // Pick anything that ended but is still 'active'. We flip status AFTER
  // sending the pushes so a crash mid-flight leaves the hangout to be
  // retried on the next sweep; the per-recipient claims stop that retry
  // from pushing anyone twice.
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
  for (const h of expired) await withLock(`hangout-recap-run:${h.id}`, async () => {
    const joinerCount = h.joins.length
    const keyFor = (userId: string) => `hangout-recap:${h.id}:${userId}`
    let failed = false

    // Host recap — closes the loop and deep-links into /hangouts/recap so
    // they can leave references for joiners while the meetup is fresh.
    if (await notifyOnce(
      keyFor(h.userId),
      h.userId,
      'hangout_recap',
      `✓ Your hangout ended`,
      joinerCount > 0
        ? `${h.title} — ${joinerCount} joiner${joinerCount === 1 ? '' : 's'} — leave a quick reference?`
        : `${h.title} ended with no joiners — try again with a different time?`,
      joinerCount > 0 ? `/hangouts/recap` : `/hangouts`,
    ) === 'failed') failed = true

    // Joiner recap — same closing-ritual purpose. Deep-links so they can
    // rate the host (and any other joiners) and build the trust graph.
    for (const j of h.joins) {
      if (await notifyOnce(
        keyFor(j.userId),
        j.userId,
        'hangout_recap',
        `✓ Hangout ended`,
        `${h.title} with ${h.user.name} — leave a quick reference?`,
        `/hangouts/recap`,
      ) === 'failed') failed = true
    }

    // Retry a failed recap on the next run, but not indefinitely.
    if (failed && now.getTime() - h.endsAt.getTime() < RECAP_RETRY_MS) return
    await prisma.hangout.update({
      where: { id: h.id },
      data:  { status: 'expired' },
    })
    expiredCount++
  })

  return { now: now.toISOString(), startingCount, expiredCount }
}

export async function POST(req: NextRequest) {
  const denied = await authorize(req)
  if (denied) return denied

  try {
    const result = await runSweep()
    await recordCronRun('sweep-hangouts', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-hangouts]', e)
    await recordCronRun('sweep-hangouts', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// No GET handler: the old "?key=<CRON_SECRET>" browser-testing path put
// the secret in query strings (nginx access logs, browser history) — the
// same class as the 2026-08 DB-password-in-crontab incident. Test with:
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" <url>
