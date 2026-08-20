import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { citiesByToday } from '@/lib/city'
import { expectedSpotsLeft } from '@/lib/spotsLeft'
import { recordCronRun } from '@/lib/cronHealth'

// Nightly spotsLeft reconciliation. Event.spotsLeft is a cached counter
// kept in sync by increment/decrement on the RSVP / participant paths —
// but flows that remove attendee rows in bulk (account deletion, admin
// user removal) have historically missed the matching adjustment, leaving
// upcoming events with phantom "going" counts (seen in prod: spotsLeft
// 6/8 with zero attendee rows). This sweep re-derives
//   spotsLeft = max(0, totalSpots - approved non-host attendees)
// for every upcoming published event and persists whatever drifted.
//
// Guarded per-row on the current spotsLeft (updateMany with spotsLeft in
// the WHERE) so a concurrent RSVP always wins — every legitimate spot
// change goes through a spotsLeft write, which voids the guard. Idempotent
// — a second run finds nothing to fix.
//
// Past events are deliberately untouched: their spotsLeft is the
// historical "X went" record, and their attendee rows may have been
// legitimately pruned by account deletions.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is
// unset, the endpoint refuses with 503 so a misconfigured prod doesn't
// silently leave the sweeper open to the internet.

export const dynamic = 'force-dynamic'

// Cron secret check delegated to lib/cronAuth.ts so the comparison is
// constant-time (timingSafeEqual) instead of `!==`. See that file for
// the rationale.
import { checkCronAuth } from '@/lib/cronAuth'

async function runSweep() {
  // "Upcoming" is per city: one `today` for the whole network reconciles a day
  // too many or too few wherever the calendar has already turned. Cities in one
  // zone share a group, so this is the same single query it always was until a
  // city sits in a different zone.
  const events = (await Promise.all(
    (await citiesByToday()).map(({ date, cityIds }) => prisma.event.findMany({
      where:  { status: 'published', cityId: { in: cityIds }, date: { gte: date } },
      select: { id: true, title: true, totalSpots: true, spotsLeft: true },
    })),
  )).flat()

  const fixes: string[] = []
  for (const e of events) {
    const expected = await expectedSpotsLeft(e.id, e.totalSpots)
    if (expected === e.spotsLeft) continue
    const res = await prisma.event.updateMany({
      where: { id: e.id, spotsLeft: e.spotsLeft },
      data:  { spotsLeft: expected },
    })
    if (res.count) fixes.push(`${e.title} (${e.id}): ${e.spotsLeft} → ${expected}`)
  }

  if (fixes.length) console.log('[cron sweep-event-spots]', fixes.join('; '))
  return { scanned: events.length, fixed: fixes.length, fixes }
}

export async function POST(req: NextRequest) {
  const denied = await checkCronAuth(req)
  if (denied) return denied

  try {
    const result = await runSweep()
    await recordCronRun('sweep-event-spots', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-event-spots]', e)
    await recordCronRun('sweep-event-spots', false, e)
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
  const key = req.nextUrl.searchParams.get('key') ?? ''
  // Constant-time comparison — see lib/cronAuth.ts.
  const a = Buffer.from(key)
  const b = Buffer.from(expected)
  const { timingSafeEqual } = await import('crypto')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-event-spots]', e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
