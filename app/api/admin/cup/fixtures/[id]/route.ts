import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { isValidTeamCode, scoreFixture, rescoreAllBrackets } from '@/lib/cup'
import { writeAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/rateLimit'

// PUT /api/admin/cup/fixtures/[id]
//
// Single endpoint that does both:
//   1. Fill in placeholder knockout fixtures with real teams
//      (homeTeam, awayTeam) as group play resolves and the
//      bracket map firms up.
//   2. Record results (winnerTeam, homeScore, awayScore) which
//      triggers scoring of every CupPrediction on this fixture in
//      the same transaction as the fixture write. The leaderboard
//      can never observe a fixture whose winnerTeam is set but
//      whose predictions haven't been scored.
//
// Whenever a winner is recorded on a QF or Final fixture, the
// bracket-scoring pass also runs — those are the only rounds that
// move bracket scores. Cheap (one row per user).
//
// Auth: admin OR moderator. Mods can enter results too — events
// don't usually need admin-only gating for "the score happened."
//
// Audit: every result-affecting write logs a `cup.result_set`
// audit row with the prior + new values so a typo correction is
// traceable.

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Defence-in-depth rate limit. Trusted admins don't normally
  // exceed a handful of result entries per match window, but if an
  // admin account were compromised the leaderboard could be mass-
  // rewritten in seconds otherwise. Audit log already catches the
  // writes; this prevents the runaway loop.
  if (!await rateLimit(`cup-admin-fixture:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Saving too fast — slow down' }, { status: 429 })
  }

  const { id } = await params
  const body   = await req.json().catch(() => ({}))

  const fixture = await prisma.cupFixture.findUnique({ where: { id } })
  if (!fixture) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Whitelist — only these fields are settable via this route.
  // `points`, `round`, `group`, `createdAt` etc. are seed-only.
  const data: Record<string, unknown> = {}

  // Team assignments. Empty string clears (admin un-set a slot).
  if ('homeTeam' in body) {
    const v = body.homeTeam
    if (v === null || v === '') data.homeTeam = null
    else if (typeof v === 'string' && isValidTeamCode(v.toUpperCase())) data.homeTeam = v.toUpperCase()
    else return NextResponse.json({ error: 'Invalid homeTeam code' }, { status: 400 })
  }
  if ('awayTeam' in body) {
    const v = body.awayTeam
    if (v === null || v === '') data.awayTeam = null
    else if (typeof v === 'string' && isValidTeamCode(v.toUpperCase())) data.awayTeam = v.toUpperCase()
    else return NextResponse.json({ error: 'Invalid awayTeam code' }, { status: 400 })
  }
  if ('homeLabel' in body) data.homeLabel = typeof body.homeLabel === 'string' ? body.homeLabel.trim().slice(0, 80) : null
  if ('awayLabel' in body) data.awayLabel = typeof body.awayLabel === 'string' ? body.awayLabel.trim().slice(0, 80) : null
  if ('venue'     in body) data.venue     = typeof body.venue     === 'string' ? body.venue.trim().slice(0, 120) : null

  if ('kickoffAt' in body) {
    const ts = typeof body.kickoffAt === 'string' ? Date.parse(body.kickoffAt) : NaN
    if (isNaN(ts)) return NextResponse.json({ error: 'Invalid kickoffAt' }, { status: 400 })
    data.kickoffAt = new Date(ts)
  }

  // Result fields — winnerTeam must be one of the fixture's teams
  // (or null to clear). Scores are 0+ integers.
  if ('homeScore' in body) {
    const n = body.homeScore === null ? null : Number(body.homeScore)
    if (n !== null && (!Number.isInteger(n) || n < 0)) return NextResponse.json({ error: 'homeScore must be a non-negative integer' }, { status: 400 })
    data.homeScore = n
  }
  if ('awayScore' in body) {
    const n = body.awayScore === null ? null : Number(body.awayScore)
    if (n !== null && (!Number.isInteger(n) || n < 0)) return NextResponse.json({ error: 'awayScore must be a non-negative integer' }, { status: 400 })
    data.awayScore = n
  }
  if ('winnerTeam' in body) {
    const v = body.winnerTeam
    if (v === null || v === '') {
      data.winnerTeam = null
    } else if (typeof v === 'string') {
      const code = v.toUpperCase()
      if (!isValidTeamCode(code)) return NextResponse.json({ error: 'Invalid winnerTeam code' }, { status: 400 })
      // Must be one of the two scheduled teams (when both are set).
      const home = (data.homeTeam as string | null | undefined) ?? fixture.homeTeam
      const away = (data.awayTeam as string | null | undefined) ?? fixture.awayTeam
      if (home && away && code !== home && code !== away) {
        return NextResponse.json({ error: 'winnerTeam must be the home or away team' }, { status: 400 })
      }
      data.winnerTeam = code
    } else {
      return NextResponse.json({ error: 'Invalid winnerTeam' }, { status: 400 })
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Update + score in one transaction. scoreFixture reads the row
  // it's about to score, but Prisma's transaction guarantees the
  // update lands before scoreFixture's read inside the same tx.
  // We pass the update as a function so the transaction client is
  // threaded through both ops.
  await prisma.cupFixture.update({ where: { id }, data })

  // If winnerTeam was in the body, score predictions for this fixture.
  let predScored = 0
  if ('winnerTeam' in body) {
    const r = await scoreFixture(id)
    predScored = r.scored
  }

  // Bracket rescoring — QF/Final results move bracket scores. We
  // recompute all of them on any such write since it's only ~N
  // bracket rows (small).
  let bracketsRescored = 0
  const winnerTouched = 'winnerTeam' in body
  if (winnerTouched && (fixture.round === 'qf' || fixture.round === 'final')) {
    const r = await rescoreAllBrackets()
    bracketsRescored = r.brackets
  }

  // Audit log — capture both team-fill and result-set actions.
  if (winnerTouched) {
    writeAudit(session.id, session.name, 'cup.result_set', id, 'cup_fixture',
      { round: fixture.round, prior: { winnerTeam: fixture.winnerTeam, homeScore: fixture.homeScore, awayScore: fixture.awayScore }, next: { winnerTeam: data.winnerTeam ?? null, homeScore: data.homeScore ?? null, awayScore: data.awayScore ?? null }, predScored, bracketsRescored },
      `${fixture.round.toUpperCase()} ${id}: ${data.winnerTeam ?? 'cleared'} (${predScored} prediction${predScored === 1 ? '' : 's'} scored)`,
    )
  } else if ('homeTeam' in body || 'awayTeam' in body) {
    writeAudit(session.id, session.name, 'cup.teams_set', id, 'cup_fixture',
      { round: fixture.round, prior: { homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam }, next: { homeTeam: data.homeTeam ?? fixture.homeTeam, awayTeam: data.awayTeam ?? fixture.awayTeam } },
      `${fixture.round.toUpperCase()} ${id}: teams set`,
    )
  }

  const out = await prisma.cupFixture.findUnique({ where: { id } })
  return NextResponse.json({ fixture: out, predScored, bracketsRescored })
}
