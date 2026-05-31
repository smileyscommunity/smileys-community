import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { periodFor, eligibilityCutoff, MIN_DAYS_FOR_NPS } from '@/lib/nps'

// GET /api/survey/nps
//
// Returns the current period plus the responder's eligibility state
// so the form can render the right UX:
//
//   - { eligible: true,  period }                       → render form
//   - { eligible: false, reason: 'submitted', period }  → "Thanks — already recorded for this quarter"
//   - { eligible: false, reason: 'too-new'  , period }  → "Welcome aboard! Your NPS unlocks after 30 days"
//   - { eligible: false, reason: 'no-session' }         → caller hits this anonymous; 401
//
// No PII about other responders is exposed. userId is never returned
// in the admin surface either — the same wedge as EventSurvey.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const period = periodFor()

  // Eligibility: joined ≥ 30 days ago, status 'approved'. We tolerate
  // pending/banned through the form's natural failure (they can hit
  // it but the cron never nudges them).
  const user = await prisma.user.findUnique({
    where:  { id: session.id },
    select: { joinedAt: true, status: true },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (user.joinedAt > eligibilityCutoff()) {
    return NextResponse.json({ eligible: false, reason: 'too-new', period, minDays: MIN_DAYS_FOR_NPS })
  }

  const existing = await prisma.memberNPS.findUnique({
    where:  { userId_period: { userId: session.id, period } },
    select: { id: true, score: true },
  })
  if (existing) {
    return NextResponse.json({ eligible: false, reason: 'submitted', period, yourScore: existing.score })
  }

  return NextResponse.json({ eligible: true, period })
}

// POST /api/survey/nps
//
// Stores the score + optional comment. Re-submissions within the
// same period overwrite the prior response (upsert) so a typo can
// be corrected without juggling DELETE + POST. The unique constraint
// (userId, period) guarantees one row per quarter.
//
// userId stays server-side: admin endpoints aggregate scores and
// surface comments WITHOUT the responder. Same anonymity wedge as
// EventSurvey — honest scoring only happens when the responder
// trusts they can't be identified.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  // Score must be an integer 0–10. Coerce string-from-form via Number,
  // reject anything else.
  const scoreRaw = body.score
  const score    = typeof scoreRaw === 'number' ? scoreRaw : Number(scoreRaw)
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return NextResponse.json({ error: 'score must be an integer 0–10' }, { status: 400 })
  }
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : null

  // Re-run eligibility — clients can't be trusted to honour GET. The
  // joinedAt floor matters: a brand-new account spinning up to skew
  // scores has to wait the same 30 days as everyone else.
  const user = await prisma.user.findUnique({
    where:  { id: session.id },
    select: { joinedAt: true },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (user.joinedAt > eligibilityCutoff()) {
    return NextResponse.json({ error: 'Account too new for NPS' }, { status: 403 })
  }

  const period = periodFor()

  await prisma.memberNPS.upsert({
    where:  { userId_period: { userId: session.id, period } },
    create: { userId: session.id, score, comment: comment || null, period },
    update: { score, comment: comment || null },
  })

  return NextResponse.json({ ok: true, period })
}
