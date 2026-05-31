import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isApprovedMember, isValidTeamCode, tournamentStartAt } from '@/lib/cup'
import { rateLimit } from '@/lib/rateLimit'

// GET /api/cup/bracket
//
// Returns the caller's bracket pick (champion + 4 semifinalists)
// plus the tournament start time, which the form uses to render
// "locked" state once first kickoff passes. Returns null for the
// pick when none submitted yet. Logged-out: 401.
//
// Tournament start is read from the first fixture's kickoffAt so a
// schedule shift can't accidentally early-lock the form.

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [bracket, tournamentStart] = await Promise.all([
    prisma.cupBracketPick.findUnique({
      where:  { userId: session.id },
      select: { championPick: true, semifinalists: true, submittedAt: true, updatedAt: true, pointsAwarded: true },
    }),
    tournamentStartAt(),
  ])

  return NextResponse.json({
    bracket,
    tournamentStartAt: tournamentStart,
    locked: tournamentStart ? tournamentStart.getTime() <= Date.now() : false,
  })
}

// POST /api/cup/bracket
//
// Upsert the caller's bracket pick. Validation:
//   1. Authenticated + approved member of the cup club
//   2. Tournament hasn't started yet (first fixture's kickoffAt > now)
//   3. semifinalists is exactly 4 distinct valid ISO-3 codes
//   4. championPick is a valid ISO-3 code AND appears in semifinalists
//
// Re-submitting before lock overwrites. Once tournament starts,
// 403 — no edits.

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await isApprovedMember(session.id)) {
    return NextResponse.json({ error: 'Only approved members can play' }, { status: 403 })
  }

  // Bracket is upsert-on-one-row, so the abuse surface is tiny —
  // but a tight cap stops a runaway retry loop from hammering the
  // table. 10/min is generous for "I changed my mind, edit again".
  if (!await rateLimit(`cup-bracket:${session.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Saving too fast — slow down' }, { status: 429 })
  }

  const start = await tournamentStartAt()
  if (start && start.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Bracket picks are locked — tournament has started' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const championPick = typeof body.championPick === 'string' ? body.championPick.trim().toUpperCase() : ''
  const semifinalistsRaw = Array.isArray(body.semifinalists) ? body.semifinalists : []
  const semifinalists: string[] = semifinalistsRaw
    .filter((s: unknown): s is string => typeof s === 'string')
    .map((s: string) => s.trim().toUpperCase())

  if (semifinalists.length !== 4) {
    return NextResponse.json({ error: 'semifinalists must be exactly 4 teams' }, { status: 400 })
  }
  if (new Set(semifinalists).size !== 4) {
    return NextResponse.json({ error: 'semifinalists must be distinct' }, { status: 400 })
  }
  if (!semifinalists.every(isValidTeamCode)) {
    return NextResponse.json({ error: 'Invalid team code in semifinalists' }, { status: 400 })
  }
  if (!isValidTeamCode(championPick)) {
    return NextResponse.json({ error: 'Invalid champion team code' }, { status: 400 })
  }
  if (!semifinalists.includes(championPick)) {
    return NextResponse.json({ error: 'champion must be one of your semifinalists' }, { status: 400 })
  }

  const bracket = await prisma.cupBracketPick.upsert({
    where:  { userId: session.id },
    create: { userId: session.id, championPick, semifinalists },
    update: { championPick, semifinalists },
    select: { championPick: true, semifinalists: true, submittedAt: true, updatedAt: true, pointsAwarded: true },
  })

  return NextResponse.json({ ok: true, bracket })
}
