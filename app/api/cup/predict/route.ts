import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isApprovedMember, isFixtureLocked, isPickAllowedForFixture } from '@/lib/cup'
import { rateLimit } from '@/lib/rateLimit'

// POST /api/cup/predict
//
// Members of the world-cup-2026 club submit (or update) a pick for
// a single fixture. Upsert semantics — re-submitting before the
// fixture's kickoffAt overwrites the prior pick. Once kickoff
// passes the row is hard-locked: even if a client retries, the
// route returns 403.
//
// Validation cascade:
//   1. Authenticated + approved member of the cup club
//   2. Fixture exists
//   3. Fixture's kickoffAt hasn't passed (lock check)
//   4. pickedTeam is a valid ISO-3 code, AND
//      - matches the fixture's home or away when both are set
//      - otherwise just needs to be a valid qualified team (early
//        knockout slot where teams are still TBD)
//
// Server-side anti-tamper: pointsAwarded is NEVER read from the
// request body. It's set by the admin result-entry route when
// winnerTeam is recorded.
//
// CSRF: the session cookie is SameSite=Lax (see lib/session.ts),
// so cross-site POSTs from a malicious page don't carry the
// cookie — the auth check below 401s and the route refuses
// before reading the body. No additional token needed for this
// endpoint.

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await isApprovedMember(session.id)) {
    return NextResponse.json({ error: 'Only approved members can play' }, { status: 403 })
  }

  // Layered rate limit. 30/min stops a buggy retry loop or a
  // half-hearted scripted spam; 500/day caps a sustained campaign
  // (members would normally touch ~100 fixtures over the tournament).
  // Both keyed on userId — leaderboard fairness depends on the
  // upsert flow staying honest, not on volume.
  if (!await rateLimit(`cup-predict:${session.id}`,     30,  60_000))           return NextResponse.json({ error: 'Picking too fast — slow down' }, { status: 429 })
  if (!await rateLimit(`cup-predict-day:${session.id}`, 500, 24 * 60 * 60_000)) return NextResponse.json({ error: 'Daily pick cap reached. Try tomorrow.' }, { status: 429 })

  const body = await req.json().catch(() => ({}))
  const fixtureId = typeof body.fixtureId === 'string' ? body.fixtureId.trim() : ''
  const pickedTeam = typeof body.pickedTeam === 'string' ? body.pickedTeam.trim().toUpperCase() : ''
  if (!fixtureId || !pickedTeam) {
    return NextResponse.json({ error: 'fixtureId + pickedTeam required' }, { status: 400 })
  }
  // Defence-in-depth: shape-check pickedTeam against the ISO-3
  // pattern before the dictionary lookup. isPickAllowedForFixture
  // below would catch an unknown code, but rejecting non-conforming
  // strings here means malformed input doesn't even reach the
  // fixture lookup.
  if (!/^[A-Z]{3}$/.test(pickedTeam)) {
    return NextResponse.json({ error: 'pickedTeam must be a 3-letter ISO code' }, { status: 400 })
  }
  // Same shape guard for fixtureId — IDs are constructed by the
  // seed in a fixed shape, so anything else is an obvious tamper
  // attempt.
  if (!/^2026-WC-[A-Z0-9-]{1,40}$/.test(fixtureId)) {
    return NextResponse.json({ error: 'invalid fixtureId' }, { status: 400 })
  }

  const fixture = await prisma.cupFixture.findUnique({
    where:  { id: fixtureId },
    select: { id: true, kickoffAt: true, homeTeam: true, awayTeam: true, points: true, round: true },
  })
  if (!fixture) return NextResponse.json({ error: 'Fixture not found' }, { status: 404 })

  if (isFixtureLocked(fixture.kickoffAt)) {
    return NextResponse.json({ error: 'Picks for this match are locked' }, { status: 403 })
  }

  if (!isPickAllowedForFixture(pickedTeam, { homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam })) {
    return NextResponse.json({ error: 'Invalid team for this fixture' }, { status: 400 })
  }

  const prediction = await prisma.cupPrediction.upsert({
    where:  { userId_fixtureId: { userId: session.id, fixtureId } },
    create: { userId: session.id, fixtureId, pickedTeam },
    update: { pickedTeam },
    select: { id: true, pickedTeam: true, submittedAt: true, updatedAt: true },
  })

  return NextResponse.json({ ok: true, prediction })
}
