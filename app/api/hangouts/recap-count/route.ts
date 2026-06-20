import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// Lightweight endpoint — returns only the total number of outstanding
// references the caller still needs to leave. Used by the hangouts feed
// to show a pending badge on the "Rate hangouts" link without fetching
// the full recap payload.

const WRITE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now         = new Date()
  const windowStart = new Date(now.getTime() - WRITE_WINDOW_MS)

  const hangouts = await prisma.hangout.findMany({
    where: {
      endsAt: { lt: now, gte: windowStart },
      status: { in: ['active', 'expired'] },
      OR: [
        { userId: session.id },
        { joins: { some: { userId: session.id } } },
      ],
    },
    select: {
      userId: true,
      joins:       { select: { userId: true } },
      references:  { where: { fromUserId: session.id }, select: { toUserId: true } },
    },
  })

  let pending = 0
  for (const h of hangouts) {
    const participants = [
      { id: h.userId },
      ...h.joins.map(j => ({ id: j.userId })),
    ].filter(p => p.id !== session.id)

    const rated = new Set(h.references.map(r => r.toUserId))
    pending += participants.filter(p => !rated.has(p.id)).length
  }

  return NextResponse.json({ pending })
}
