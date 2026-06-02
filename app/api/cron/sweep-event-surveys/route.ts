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
  const now           = new Date()
  const oneDayAgo     = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const sevenDaysAgo  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000)
  const todayStr      = now.toISOString().slice(0, 10)

  // Event.date is a yyyy-mm-dd string and Event.endTime is optional
  // "HH:MM". To keep the query simple we filter by date range (events
  // whose date is between 1 and 7 days ago, exclusive of today) — close
  // enough for an hourly sweep since the eligibility window the form
  // checks is 7 days. The few edge-of-window events skipped here are
  // picked up on the next hourly run.
  const candidates = await prisma.event.findMany({
    where: {
      status:             'published',
      surveyDispatchedAt: null,
      date:               { lt: todayStr, gte: sevenDaysAgo.toISOString().slice(0, 10) },
    },
    select: {
      id: true, title: true, emoji: true, date: true, endTime: true,
      hostId: true,
    },
  })

  let dispatchedEvents   = 0
  let dispatchedNotices  = 0

  for (const event of candidates) {
    // Make sure the event has actually ended ≥24h ago (date check
    // alone can't tell us — a 9pm event yesterday might not have hit
    // the 24h mark yet).
    const endedAt = endTimestamp(event.date, event.endTime)
    if (endedAt > oneDayAgo.getTime()) continue

    const attendees = await prisma.eventAttendee.findMany({
      where:  { eventId: event.id, status: 'approved' },
      select: { userId: true },
    })

    // Skip the host so they don't get nudged to survey their own
    // event. Co-hosts also skip — they have a host-side perspective
    // and the survey is designed for attendee voice.
    const cohostIds = await prisma.eventCoHost.findMany({
      where:  { eventId: event.id },
      select: { userId: true },
    }).then(rows => new Set(rows.map(r => r.userId)))
    const targets = attendees
      .map(a => a.userId)
      .filter(uid => uid !== event.hostId && !cohostIds.has(uid))

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

  return { now: now.toISOString(), dispatchedEvents, dispatchedNotices }
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
    console.error('[cron sweep-event-surveys]', e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
