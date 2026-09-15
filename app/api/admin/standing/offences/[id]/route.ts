import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canModerateReports, failClosedCityId } from '@/lib/access'
import { reviewConflict, eventRunners, REVIEW_CONFLICT_MESSAGE } from '@/lib/noShowPolicy'
import { resolveDispute } from '@/lib/standing'

type Params = { params: Promise<{ id: string }> }

// A moderator's decision on "I was there": overturn (they came — the offence
// goes, and any card it stood under is withdrawn) or uphold. Moderators decide
// for their own city's members; nobody decides their own offence or one from
// an event they run (the door they ran is the evidence).
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || (!isAdmin(session) && !canModerateReports(session))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const decision = body?.decision
    if (decision !== 'overturn' && decision !== 'uphold') {
      return NextResponse.json({ error: 'decision must be overturn or uphold' }, { status: 400 })
    }
    const note = typeof body?.note === 'string' ? body.note : ''

    const offence = await prisma.standingOffence.findUnique({
      where:  { id },
      select: {
        userId: true,
        user:   { select: { cityId: true } },
        event:  { select: {
          hostId:  true,
          cohosts: { select: { userId: true } },
          club:    { select: { memberships: { where: { role: 'host', status: 'approved' }, select: { userId: true } } } },
        } },
      },
    })
    if (!offence) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!isAdmin(session) && offence.user.cityId !== failClosedCityId(session)) {
      return NextResponse.json({ error: 'Cross-city moderation is admin-only' }, { status: 403 })
    }
    const conflict = reviewConflict(session.id, offence, eventRunners(offence.event))
    if (conflict) return NextResponse.json({ error: REVIEW_CONFLICT_MESSAGE[conflict], code: conflict }, { status: 403 })

    const outcome = await resolveDispute({ offenceId: id, resolver: { id: session.id, name: session.name }, decision, note })
    if (outcome === 'ok')        return NextResponse.json({ ok: true })
    if (outcome === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: 'This dispute has already been resolved' }, { status: 409 })
  } catch (e) {
    console.error('[admin standing offence]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
