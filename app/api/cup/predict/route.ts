import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { getCupClubMembership, isFixtureLocked, isPickAllowedForFixture } from '@/lib/cup'

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

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const membership = await getCupClubMembership(session.id)
  if (!membership) {
    return NextResponse.json({ error: 'Join the Smileys Cup club to play' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const fixtureId = typeof body.fixtureId === 'string' ? body.fixtureId.trim() : ''
  const pickedTeam = typeof body.pickedTeam === 'string' ? body.pickedTeam.trim().toUpperCase() : ''
  if (!fixtureId || !pickedTeam) {
    return NextResponse.json({ error: 'fixtureId + pickedTeam required' }, { status: 400 })
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
