import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// GET /api/cup/leaderboard
//
// Returns the top N players ranked by total score plus the
// caller's own row when logged in. Public read — drives the
// "look who's playing" social proof on /cup, including the
// logged-out apply CTA.
//
// Score = sum(CupPrediction.pointsAwarded) + CupBracketPick
// .pointsAwarded. Both columns are written by the admin result-
// entry route inside the same transaction as winnerTeam, so the
// numbers reconcile by construction — no separate scoring job
// is needed.
//
// Tiebreaker: earlier bracketSubmittedAt wins (rewards commitment).
// Ranks are dense (1, 2, 2, 4 for ties to allow inspection of
// "you and N others tied at this rank" semantics).
//
// Anonymity: we expose name + first initial of last name + color + profile photo.

export const dynamic = 'force-dynamic'

const DEFAULT_TAKE = 50

export async function GET(req: Request) {
  const session = await getSession()
  const url     = new URL(req.url)
  const take    = Math.min(Math.max(parseInt(url.searchParams.get('take') ?? `${DEFAULT_TAKE}`), 1), 200)

  // Cheap short-circuit: the leaderboard only changes when an
  // admin records a fixture result (which updates CupFixture +
  // re-scores CupPrediction.pointsAwarded). If the caller passes
  // ?since=<iso> and the highest fixture updatedAt is at or before
  // that, the leaderboard is byte-for-byte the same as what they
  // already have — return 304 instead of recomputing + shipping a
  // ~30KB payload every 30 seconds during finals. Safe to ignore:
  // older clients just omit the param and get the full payload.
  const sinceParam = url.searchParams.get('since')
  if (sinceParam) {
    const sinceMs = Date.parse(sinceParam)
    if (!Number.isNaN(sinceMs)) {
      const watermark = await prisma.cupFixture.aggregate({ _max: { updatedAt: true } })
      const maxMs = watermark._max.updatedAt?.getTime() ?? 0
      if (maxMs <= sinceMs) return new Response(null, { status: 304 })
    }
  }

  // Pull every prediction's points + bracket aggregate + eligible
  // member count in parallel. groupBy + a separate findMany is
  // much cheaper than a join here (Prisma typed _sum doesn't
  // compose with the bracket's per-row metadata; one groupBy + one
  // findMany keeps the queries index-friendly). Eligible count is
  // surfaced to the empty-state copy on /cup ("0 of 47 members
  // playing — nobody has locked in yet").
  const [predGroups, brackets, eligibleCount] = await Promise.all([
    prisma.cupPrediction.groupBy({
      by: ['userId'],
      _sum: { pointsAwarded: true },
    }),
    prisma.cupBracketPick.findMany({
      select: { userId: true, pointsAwarded: true, submittedAt: true },
    }),
    prisma.user.count({ where: { status: 'approved' } }),
  ])

  // Build a per-user accumulator.
  type Row = {
    userId:             string
    matchScore:         number
    bracketScore:       number
    bracketSubmittedAt: Date | null
  }
  const rows = new Map<string, Row>()
  for (const g of predGroups) {
    rows.set(g.userId, {
      userId:             g.userId,
      matchScore:         g._sum.pointsAwarded ?? 0,
      bracketScore:       0,
      bracketSubmittedAt: null,
    })
  }
  for (const b of brackets) {
    const row = rows.get(b.userId) ?? { userId: b.userId, matchScore: 0, bracketScore: 0, bracketSubmittedAt: null }
    row.bracketScore       = b.pointsAwarded
    row.bracketSubmittedAt = b.submittedAt
    rows.set(b.userId, row)
  }

  // Sort: total score DESC, earlier bracket submission ASC.
  const sorted = Array.from(rows.values())
    .map(r => ({ ...r, score: r.matchScore + r.bracketScore }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      const ta = a.bracketSubmittedAt?.getTime() ?? Infinity
      const tb = b.bracketSubmittedAt?.getTime() ?? Infinity
      return ta - tb
    })

  // Dense ranking — ties share a rank.
  let prevScore = Infinity
  let rank = 0
  const ranked = sorted.map((r, idx) => {
    if (r.score !== prevScore) rank = idx + 1
    prevScore = r.score
    return { ...r, rank }
  })

  // Resolve display names for the top `take` slots + the caller's
  // own row (if not already in the top slot).
  const slice    = ranked.slice(0, take)
  const youRow   = session ? ranked.find(r => r.userId === session.id) : null
  const needIds  = new Set<string>(slice.map(r => r.userId))
  if (youRow) needIds.add(youRow.userId)
  const users    = needIds.size === 0 ? [] : await prisma.user.findMany({
    where:  { id: { in: Array.from(needIds) } },
    select: { id: true, name: true, color: true, profilePhoto: true },
  })
  const userMap = new Map(users.map(u => [u.id, u]))

  const displayName = (full: string): string => {
    // First name + last-name initial — keeps the leaderboard
    // readable without surfacing full names to casual viewers.
    const parts = full.trim().split(/\s+/)
    if (parts.length < 2) return parts[0] ?? '—'
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`
  }

  return NextResponse.json({
    rows: slice.map((r, idx) => {
      const u = userMap.get(r.userId)
      return {
        rank:         r.rank,
        name:         u ? displayName(u.name) : '—',
        color:        u?.color ?? '#f59e0b',
        profilePhoto: u?.profilePhoto ?? null,
        score:        r.score,
        matchScore:   r.matchScore,
        bracketScore: r.bracketScore,
        isYou:        session?.id === r.userId,
      }
    }),
    yourRank:  youRow?.rank ?? null,
    yourScore: youRow?.score ?? null,
    total:     ranked.length,
    eligible:  eligibleCount,
    lastUpdated: new Date().toISOString(),
  })
}
