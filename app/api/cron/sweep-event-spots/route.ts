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

  // Club.memberCount reconciliation rides the same nightly sweep. The
  // member-facing join/leave/approve paths pair the write and the counter
  // in a transaction now, but bulk flows can still drift it (same story as
  // spotsLeft) — and unlike spotsLeft this counter previously had no
  // safety net beyond the manual admin recount button. Guarded per-row on
  // the current value so a concurrent join/leave wins.
  const [clubs, approvedByClub] = await Promise.all([
    prisma.club.findMany({ select: { id: true, name: true, memberCount: true } }),
    prisma.clubMembership.groupBy({ by: ['clubId'], where: { status: 'approved' }, _count: { _all: true } }),
  ])
  const trueCounts = new Map(approvedByClub.map(g => [g.clubId, g._count._all]))
  const clubFixes: string[] = []
  for (const c of clubs) {
    const expected = trueCounts.get(c.id) ?? 0
    if (expected === c.memberCount) continue
    const res = await prisma.club.updateMany({
      where: { id: c.id, memberCount: c.memberCount },
      data:  { memberCount: expected },
    })
    if (res.count) clubFixes.push(`${c.name}: ${c.memberCount} → ${expected}`)
  }
  if (clubFixes.length) console.log('[cron sweep-event-spots] club recounts:', clubFixes.join('; '))

  // Expired rate_limits rows have no other cleanup path — lib/rateLimit
  // only upserts, so per-IP and per-user-pair keys accumulate forever
  // (slow bloat on the hot upsert index). A day past resetAt nothing can
  // read them: every lookup treats an expired row as a fresh window.
  const staleLimits = await prisma.rateLimit.deleteMany({
    where: { resetAt: { lt: new Date(Date.now() - 86_400_000) } },
  })

  return { scanned: events.length, fixed: fixes.length, fixes, clubsScanned: clubs.length, clubsFixed: clubFixes.length, clubFixes, staleRateLimitsPruned: staleLimits.count }
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

// No GET handler: the old "?key=<CRON_SECRET>" browser-testing path put
// the secret in query strings (nginx access logs, browser history) — the
// same class as the 2026-08 DB-password-in-crontab incident. Test with:
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" <url>
