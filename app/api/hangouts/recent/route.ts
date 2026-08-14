import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'

// Expired hangouts from the last 48 hours — used for the "Just happened"
// social proof section on the hangouts page. Shows newcomers that the
// feature is active and gives regulars FOMO for what they missed.

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)

    const hangouts = await prisma.hangout.findMany({
      where: {
        status:  'expired',
        cityId:  await resolveCityId(session),
        endsAt:  { gte: cutoff },
      },
      orderBy: { endsAt: 'desc' },
      take: 5,
      include: {
        user:  { select: { id: true, name: true, color: true, profilePhoto: true } },
        joins: { select: { userId: true } },
        _count: { select: { references: true } },
      },
    })

    // Count only good references per hangout
    const hangoutIds = hangouts.map(h => h.id)
    const goodRefs = hangoutIds.length > 0
      ? await prisma.hangoutReference.groupBy({
          by:     ['hangoutId'],
          where:  { hangoutId: { in: hangoutIds }, vibe: 'good' },
          _count: { _all: true },
        })
      : []
    const goodRefsByHangout: Record<string, number> = {}
    for (const r of goodRefs) goodRefsByHangout[r.hangoutId] = r._count._all

    const shaped = hangouts.map(h => ({
      id:           h.id,
      title:        h.title,
      neighborhood: h.neighborhood,
      endsAt:       h.endsAt,
      photo:        h.photo,
      user:         h.user,
      joinerCount:  h.joins.length,
      goodRefCount: goodRefsByHangout[h.id] ?? 0,
    }))

    return NextResponse.json({ hangouts: shaped })
  } catch (e) {
    console.error('[hangouts/recent GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
