import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { recordCronRun } from '@/lib/cronHealth'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { todayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { eventEndsAt } from '@/lib/eventTime'

// Post-event survey dispatch sweeper. Picks up events that ended
// between 24h and 7 days ago and haven't been surveyed yet, then
// notifies every approved attendee with a deep link to the feedback
// form. Stamps surveyDispatchedAt so re-runs don't duplicate.
//
// Runs hourly via system crontab (see scripts/sweep-event-surveys.sh).
// Idempotency: the surveyDispatchedAt column guards against duplicate
// notifications; transient failures self-heal on the next hourly run
// because we stamp AFTER the notifications fire.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>` (same as
// sweep-hangouts). If CRON_SECRET is unset the endpoint refuses with
// 503 so a misconfigured prod doesn't leave the sweeper open.

export const dynamic = 'force-dynamic'

// Constant-time secret check — see lib/cronAuth.ts.
import { checkCronAuth } from '@/lib/cronAuth'

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  return checkCronAuth(req)
}

// Outlives the 7-day dispatch window, so a claim can't expire and re-arm
// a send while the event is still being picked up.
const CLAIM_WINDOW_MS = 9 * 24 * 60 * 60 * 1000
const LOCK_MS         = 30 * 60 * 1000

// Stamping after the sends is what lets a failure retry — and what let two
// overlapping runs (or a retried run that died mid-loop) both survey the
// whole room. A per-recipient claim, like the reminders/no-show/reconfirm
// sweeps take, lets exactly one run send; a write that failed hands the
// claim back so the next hourly run retries that member alone.
async function notifyOnce(key: string, userId: string, title: string, body: string, link: string): Promise<'sent' | 'skipped' | 'failed'> {
  if (!await claimOnce(key, CLAIM_WINDOW_MS)) return 'skipped'
  if (await createNotification(userId, 'event_survey', title, body, link)) return 'sent'
  await releaseClaim(key)
  return 'failed'
}

// One run works an event at a time. Recipient claims alone let an
// overlapping run find everyone "already claimed" and stamp the event while
// the other run's send was failing — and the stamp ends the retry.
// Released when done; a run that crashes lets it lapse after LOCK_MS.
async function withLock(key: string, work: () => Promise<void>): Promise<void> {
  if (!await claimOnce(key, LOCK_MS)) return
  try { await work() } finally { await releaseClaim(key) }
}

async function runSweep() {
  const now            = new Date()
  const oneDayAgo      = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const twoDaysAgo     = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  // Day bounds and end-of-event instants are questions about the EVENT
  // CITY's calendar and clock — this sweep was the last one still using
  // UTC "today" (commit 6b6e54d's class) plus a hardcoded +03:00 offset,
  // both wrong for any future city outside UTC+3.
  const cities = await prisma.city.findMany({ select: { id: true, timezone: true } })
  const tzByCity = new Map(cities.map(c => [c.id, c.timezone]))

  let dispatchedEvents   = 0
  let dispatchedNotices  = 0

  // ── Pass 1: first dispatch ───────────────────────────────────────────────
  // Events that ended 24h–7 days ago and have never had a survey sent.
  const firstPass = (await Promise.all(cities.map(c => prisma.event.findMany({
    where: {
      status:             { in: ['published', 'archived'] },
      // Archiving a cancelled event keeps its cancelledAt — it never happened.
      cancelledAt:        null,
      surveyDispatchedAt: null,
      cityId:             c.id,
      date:               { lt: todayInTz(c.timezone), gte: todayInTz(c.timezone, -7) },
    },
    select: { id: true, title: true, emoji: true, date: true, time: true, endTime: true, hostId: true, cityId: true },
  })))).flat()

  for (const event of firstPass) {
    const endedAt = eventEndsAt(event, tzByCity.get(event.cityId) ?? DEFAULT_TZ).getTime()
    if (endedAt > oneDayAgo.getTime()) continue

    await withLock(`event-survey-run:${event.id}`, async () => {
      const targets = await eligibleTargets(event.id, event.hostId)
      let failed = false
      for (const userId of targets) {
        const outcome = await notifyOnce(
          `event-survey:${event.id}:${userId}`,
          userId,
          `${event.emoji} How was "${event.title}"?`,
          `Two quick questions. Anonymous to the host. Takes 20 seconds.`,
          `/events/${event.id}/feedback`,
        )
        if (outcome === 'sent') dispatchedNotices++
        if (outcome === 'failed') failed = true
      }

      // Unstamped on a failure so the next run retries it (the date filter
      // above drops it after 7 days either way).
      if (failed) return
      await prisma.event.update({
        where: { id: event.id },
        data:  { surveyDispatchedAt: now },
      })
      dispatchedEvents++
    })
  }

  // ── Pass 2: 48-hour follow-up nudge ─────────────────────────────────────
  // Events where the first dispatch happened 48h+ ago, the reminder
  // hasn't been sent yet, and the event is still within the 7-day window.
  const reminderPass = (await Promise.all(cities.map(c => prisma.event.findMany({
    where: {
      status:             { in: ['published', 'archived'] },
      cancelledAt:        null,
      surveyDispatchedAt: { lte: twoDaysAgo },
      surveyReminderAt:   null,
      cityId:             c.id,
      date:               { gte: todayInTz(c.timezone, -7) },
    },
    select: {
      id: true, title: true, emoji: true, date: true, endTime: true,
      hostId: true,
      surveys: { select: { userId: true } },
    },
  })))).flat()

  for (const event of reminderPass) await withLock(`event-survey-reminder-run:${event.id}`, async () => {
    const respondedIds = new Set(event.surveys.map(s => s.userId))
    const targets      = await eligibleTargets(event.id, event.hostId)
    // Only nudge those who haven't submitted yet.
    const nonResponders = targets.filter(uid => !respondedIds.has(uid))

    let failed = false
    for (const userId of nonResponders) {
      const outcome = await notifyOnce(
        `event-survey-reminder:${event.id}:${userId}`,
        userId,
        `${event.emoji} Still time to rate "${event.title}"`,
        `Your feedback helps us improve. Takes 20 seconds — closes in a few days.`,
        `/events/${event.id}/feedback`,
      )
      if (outcome === 'sent') dispatchedNotices++
      if (outcome === 'failed') failed = true
    }

    if (failed) return
    await prisma.event.update({
      where: { id: event.id },
      data:  { surveyReminderAt: now },
    })
    // Count as a dispatched event only if we actually sent reminders.
    if (nonResponders.length > 0) dispatchedEvents++
  })

  return { now: now.toISOString(), dispatchedEvents, dispatchedNotices }
}

async function eligibleTargets(eventId: string, hostId: string): Promise<string[]> {
  const [attendees, cohosts] = await Promise.all([
    prisma.eventAttendee.findMany({
      // Someone the no-show sweep (same hour) marked absent has nothing to
      // review — and could file an anomaly flag on an event they missed.
      // Settled events only: a host's close-out mark (lib/attendanceCloseOut)
      // is a declaration no card backs, and must not be a way to keep a room
      // out of the survey that reports on the host.
      where:  { eventId, status: 'approved', NOT: { attendance: 'no_show', event: { noShowProcessedAt: { not: null } } } },
      select: { userId: true },
    }),
    prisma.eventCoHost.findMany({
      where:  { eventId },
      select: { userId: true },
    }),
  ])
  const cohostIds = new Set(cohosts.map(c => c.userId))
  return attendees
    .map(a => a.userId)
    .filter(uid => uid !== hostId && !cohostIds.has(uid))
}

export async function POST(req: NextRequest) {
  const denied = await authorize(req)
  if (denied) return denied
  try {
    const result = await runSweep()
    await recordCronRun('sweep-event-surveys', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-event-surveys]', e)
    await recordCronRun('sweep-event-surveys', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// No GET handler: the old "?key=<CRON_SECRET>" browser-testing path put
// the secret in query strings (nginx access logs, browser history) — the
// same class as the 2026-08 DB-password-in-crontab incident. Test with:
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" <url>
