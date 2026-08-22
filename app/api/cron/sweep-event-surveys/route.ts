import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { recordCronRun } from '@/lib/cronHealth'

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
  const sevenDaysAgo   = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000)
  const todayStr       = now.toISOString().slice(0, 10)

  let dispatchedEvents   = 0
  let dispatchedNotices  = 0

  // ── Pass 1: first dispatch ───────────────────────────────────────────────
  // Events that ended 24h–7 days ago and have never had a survey sent.
  const firstPass = await prisma.event.findMany({
    where: {
      status:             { in: ['published', 'archived'] },
      surveyDispatchedAt: null,
      date:               { lt: todayStr, gte: sevenDaysAgo.toISOString().slice(0, 10) },
    },
    select: { id: true, title: true, emoji: true, date: true, endTime: true, hostId: true },
  })

  for (const event of firstPass) {
    const endedAt = endTimestamp(event.date, event.endTime)
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
  const reminderPass = await prisma.event.findMany({
    where: {
      status:             { in: ['published', 'archived'] },
      surveyDispatchedAt: { lte: twoDaysAgo },
      surveyReminderAt:   null,
      date:               { gte: sevenDaysAgo.toISOString().slice(0, 10) },
    },
    select: {
      id: true, title: true, emoji: true, date: true, endTime: true,
      hostId: true,
      surveys: { select: { userId: true } },
    },
  })

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

function endTimestamp(date: string, endTime: string | null): number {
  const time = endTime?.match(/^(\d{1,2}):(\d{2})/) ? endTime : '23:59'
  return new Date(`${date}T${time}:00+03:00`).getTime()
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
