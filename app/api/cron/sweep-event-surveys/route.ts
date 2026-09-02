import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { recordCronRun } from '@/lib/cronHealth'
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
      surveyDispatchedAt: null,
      cityId:             c.id,
      date:               { lt: todayInTz(c.timezone), gte: todayInTz(c.timezone, -7) },
    },
    select: { id: true, title: true, emoji: true, date: true, time: true, endTime: true, hostId: true, cityId: true },
  })))).flat()

  for (const event of firstPass) {
    const endedAt = eventEndsAt(event, tzByCity.get(event.cityId) ?? DEFAULT_TZ).getTime()
    if (endedAt > oneDayAgo.getTime()) continue

    const targets = await eligibleTargets(event.id, event.hostId)
    for (const userId of targets) {
      createNotification(
        userId,
        'event_survey',
        `${event.emoji} How was "${event.title}"?`,
        `Two quick questions. Anonymous to the host. Takes 20 seconds.`,
        `/events/${event.id}/feedback`,
      ).catch(() => {})
      dispatchedNotices++
    }

    await prisma.event.update({
      where: { id: event.id },
      data:  { surveyDispatchedAt: now },
    })
    dispatchedEvents++
  }

  // ── Pass 2: 48-hour follow-up nudge ─────────────────────────────────────
  // Events where the first dispatch happened 48h+ ago, the reminder
  // hasn't been sent yet, and the event is still within the 7-day window.
  const reminderPass = (await Promise.all(cities.map(c => prisma.event.findMany({
    where: {
      status:             { in: ['published', 'archived'] },
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

  for (const event of reminderPass) {
    const respondedIds = new Set(event.surveys.map(s => s.userId))
    const targets      = await eligibleTargets(event.id, event.hostId)
    // Only nudge those who haven't submitted yet.
    const nonResponders = targets.filter(uid => !respondedIds.has(uid))

    for (const userId of nonResponders) {
      createNotification(
        userId,
        'event_survey',
        `${event.emoji} Still time to rate "${event.title}"`,
        `Your feedback helps us improve. Takes 20 seconds — closes in a few days.`,
        `/events/${event.id}/feedback`,
      ).catch(() => {})
      dispatchedNotices++
    }

    await prisma.event.update({
      where: { id: event.id },
      data:  { surveyReminderAt: now },
    })
    // Count as a dispatched event only if we actually sent reminders.
    if (nonResponders.length > 0) dispatchedEvents++
  }

  return { now: now.toISOString(), dispatchedEvents, dispatchedNotices }
}

async function eligibleTargets(eventId: string, hostId: string): Promise<string[]> {
  const [attendees, cohosts] = await Promise.all([
    prisma.eventAttendee.findMany({
      where:  { eventId, status: 'approved' },
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
