import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canModerateReports } from '@/lib/access'
import { requireStepUp } from '@/lib/stepUp'
import { standingEnforcement, setStandingEnforced } from '@/lib/standing'
import { LIVE_CARD_STATUSES, OffenceStatus, CardLevel } from '@/lib/standingPolicy'

// The standing switch, and the numbers to read before touching it. Until it is
// on, the sweep records everything in shadow: nothing reaches members. Admins
// only may switch it, behind step-up; switching on retires the shadow cards.
export const dynamic = 'force-dynamic'

const DAY = 24 * 60 * 60 * 1000

export async function GET() {
  try {
    const session = await getSession()
    if (!session || (!isAdmin(session) && !canModerateReports(session))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // The counts are network-wide: admins only. Moderators see the switch's state.
    if (!isAdmin(session)) return NextResponse.json(await standingEnforcement())
    const since30 = new Date(Date.now() - 30 * DAY)
    const [enforcement, offences30, counting30, disputed, liveYellow, liveRed, shadowLive, autoResolved30, forgiven30] = await Promise.all([
      standingEnforcement(),
      prisma.standingOffence.count({ where: { recordedAt: { gte: since30 } } }),
      prisma.standingOffence.count({ where: { recordedAt: { gte: since30 }, counts: true, status: { in: [OffenceStatus.Open, OffenceStatus.Disputed] } } }),
      prisma.standingOffence.count({ where: { status: OffenceStatus.Disputed } }),
      prisma.standingCard.count({ where: { level: CardLevel.Yellow, status: { in: LIVE_CARD_STATUSES }, shadow: false } }),
      prisma.standingCard.count({ where: { level: CardLevel.Red,    status: { in: LIVE_CARD_STATUSES }, shadow: false } }),
      prisma.standingCard.count({ where: { status: { in: LIVE_CARD_STATUSES }, shadow: true } }),
      prisma.eventAttendee.count({ where: { attendanceAutoResolvedAt: { gte: since30 } } }),
      prisma.standingOffence.count({ where: { recordedAt: { gte: since30 }, status: OffenceStatus.Forgiven } }),
    ])
    return NextResponse.json({
      ...enforcement,
      stats: { offences30, counting30, disputed, liveYellow, liveRed, shadowLive, autoResolved30, forgiven30 },
    })
  } catch (e) {
    console.error('[admin standing enforcement GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const stepUp = requireStepUp(session)
    if (stepUp) return stepUp
    const body = await req.json().catch(() => ({}))
    if (typeof body?.on !== 'boolean') return NextResponse.json({ error: 'on must be true or false' }, { status: 400 })
    return NextResponse.json(await setStandingEnforced(body.on, { id: session.id, name: session.name }))
  } catch (e) {
    console.error('[admin standing enforcement POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
