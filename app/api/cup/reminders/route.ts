import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isApprovedMember, isCupFinishedNow } from '@/lib/cup'
import { cupReminderRefusal } from '@/lib/cup-data'

// POST /api/cup/reminders — the gate in front of a cup match-reminder
// sign-up. The /cup opt-in strip calls it before asking the browser for
// push permission; the subscription itself still goes through the shared
// /api/push/subscribe (a device subscribes once for every push channel, so
// that route can't refuse on the cup's behalf).
//
// The strip used to offer "Match reminders" weeks after the Final, and a
// member who tapped it was told "we'll ping you before kickoffs" for a
// tournament with no kickoffs left. Now:
//   • 409 once the cup is finished (campaign wrapped/archived, Final
//     decided, or the last match's window has closed)
//   • 409 for a specific fixtureId whose kickoff has passed
//   • 200 { ok: true } otherwise
//
// Body (optional): { fixtureId?: string }

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isApprovedMember(session.id))) {
    return NextResponse.json({ error: 'Only approved members can turn on match reminders' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const fixtureId = typeof body?.fixtureId === 'string' && body.fixtureId ? body.fixtureId : null

  const now = new Date()
  const finished = await isCupFinishedNow(now)

  let kickoffAt: Date | null = null
  if (!finished && fixtureId) {
    const fixture = await prisma.cupFixture.findUnique({ where: { id: fixtureId }, select: { kickoffAt: true } })
    if (!fixture) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    kickoffAt = fixture.kickoffAt
  }

  const refusal = cupReminderRefusal({ finished, kickoffAt, now })
  if (refusal) return NextResponse.json({ error: refusal, finished }, { status: 409 })

  return NextResponse.json({ ok: true })
}
