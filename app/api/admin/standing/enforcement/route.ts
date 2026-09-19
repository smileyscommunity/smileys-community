import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canModerateReports } from '@/lib/access'
import { requireStepUp } from '@/lib/stepUp'
import { standingEnforcement, setStandingEnforced } from '@/lib/standing'
import { LIVE_CARD_STATUSES, OffenceStatus, CardLevel, windowStart, YELLOW_AFTER_OFFENCES } from '@/lib/standingPolicy'

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
      // Shadow cards COUNT here, because the queues these numbers open do not
      // filter them out. While enforcement is off every card is shadow, so
      // excluding them made all three card tiles read 0 in front of a full
      // list — during exactly the period an admin is reading the page to
      // decide whether to switch on. `shadowLive` below is the breakdown.
      prisma.standingCard.count({ where: { level: CardLevel.Yellow, status: { in: LIVE_CARD_STATUSES } } }),
      prisma.standingCard.count({ where: { level: CardLevel.Red,    status: { in: LIVE_CARD_STATUSES } } }),
      prisma.standingCard.count({ where: { status: { in: LIVE_CARD_STATUSES }, shadow: true } }),
      prisma.eventAttendee.count({ where: { attendanceAutoResolvedAt: { gte: since30 }, attendance: 'attended' } }),
      prisma.standingOffence.count({ where: { recordedAt: { gte: since30 }, status: OffenceStatus.Forgiven } }),
    ])

    // How many members are one offence short of a card. Without it an empty
    // cards queue says nothing: it reads the same whether the system is
    // working and nobody has earned one, or it has quietly stopped issuing.
    // Same filter decideIssuance uses, so the number means what it says.
    const loose = await prisma.standingOffence.groupBy({
      by:    ['userId'],
      where: { counts: true, status: OffenceStatus.Open, cardId: null, occurredAt: { gte: windowStart(new Date()) } },
      _count: { _all: true },
    })
    // Excluding anyone who already holds a card: their next offence escalates
    // an existing one, it does not earn them a first yellow, so counting them
    // would put them behind a sentence about "the first yellow".
    const carded = new Set((await prisma.standingCard.findMany({
      where: { status: { in: LIVE_CARD_STATUSES } }, select: { userId: true }, distinct: ['userId'],
    })).map(c => c.userId))
    const nearlyCarded = loose
      .filter(g => g._count._all === YELLOW_AFTER_OFFENCES - 1 && !carded.has(g.userId)).length

    return NextResponse.json({
      ...enforcement,
      stats: { offences30, counting30, disputed, liveYellow, liveRed, shadowLive, autoResolved30, forgiven30, nearlyCarded },
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
