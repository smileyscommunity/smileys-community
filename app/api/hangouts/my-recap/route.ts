import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// Feed for the /hangouts/recap page — lists the caller's recently-ended
// hangouts (they hosted or joined) where they still have outstanding
// references to leave. The recap push from the sweeper deep-links here.

const WRITE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000  // mirror references/route.ts

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now            = new Date()
  const windowStart    = new Date(now.getTime() - WRITE_WINDOW_MS)

  // All hangouts where I was the host OR a joiner, that have ended in the
  // last 30 days. status='expired' is set by the sweeper; we also accept
  // 'active' with endsAt < now in case the sweeper hasn't run yet.
  const hangouts = await prisma.hangout.findMany({
    where: {
      endsAt: { lt: now, gte: windowStart },
      status: { in: ['active', 'expired'] },
      OR: [
        { userId: session.id },
        { joins:  { some: { userId: session.id } } },
      ],
    },
    orderBy: { endsAt: 'desc' },
    take: 30,
    include: {
      user:  { select: { id: true, name: true, color: true, profilePhoto: true } },
      joins: {
        select: { userId: true, user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
      },
      references: {
        where:  { fromUserId: session.id },
        select: { toUserId: true, vibe: true },
      },
    },
  })

  // Shape for the client: who's still outstanding (no reference yet) vs.
  // done. Keeps the recap UI simple — no need to compute on the client.
  const shaped = hangouts.map(h => {
    const participants = [
      { id: h.user.id, name: h.user.name, color: h.user.color, profilePhoto: h.user.profilePhoto, role: 'host' as const },
      ...h.joins.map(j => ({ ...j.user, role: 'joiner' as const })),
    ].filter(p => p.id !== session.id)

    const myRefs: Record<string, string> = {}
    for (const r of h.references) myRefs[r.toUserId] = r.vibe

    const outstanding = participants.filter(p => !myRefs[p.id])

    return {
      id:           h.id,
      title:        h.title,
      location:     h.location,
      neighborhood: h.neighborhood,
      endsAt:       h.endsAt,
      iWasHost:     h.userId === session.id,
      participants,
      myRefs,
      outstandingCount: outstanding.length,
    }
  })

  return NextResponse.json({ hangouts: shaped })
}
