import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'

// Top hosts by hangouts completed in the last 30 days. Used on the
// hangouts page as a "Regulars" strip — social reward for consistent
// hosts and a signal to newcomers of who is building the community.

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const counts = await prisma.hangout.groupBy({
      by:      ['userId'],
      where:   { status: 'expired', endsAt: { gte: since }, cityId: await resolveCityId(session) },
      _count:  { _all: true },
      orderBy: { _count: { userId: 'desc' } },
      take:    5,
    })

    if (counts.length === 0) return NextResponse.json({ regulars: [] })

    const userIds = counts.map(c => c.userId)
    const users   = await prisma.user.findMany({
      where:  { id: { in: userIds } },
      select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true },
    })
    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    const regulars = counts
      .map(c => ({ ...userMap[c.userId], count: c._count._all }))
      .filter(r => r.id)

    return NextResponse.json({ regulars })
  } catch (e) {
    console.error('[hangouts/regulars GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
