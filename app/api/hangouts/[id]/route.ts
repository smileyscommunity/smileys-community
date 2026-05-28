import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { createNotification } from '@/lib/notify'

// Cancel a hangout. Host or staff only.
//
// Notifies every joiner that the hangout is off — without this push, joiners
// would silently show up to nothing because the only signal was the card
// disappearing from the feed (and most won't refresh between joining and
// leaving home).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const hangout = await prisma.hangout.findUnique({
    where: { id },
    include: {
      user:  { select: { id: true, name: true } },
      joins: { select: { userId: true } },
    },
  })
  if (!hangout) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (hangout.userId !== session.id && !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only notify if hangout was actually active — re-cancellation noop should
  // not re-spam joiners.
  const wasActive = hangout.status === 'active'

  await prisma.hangout.update({ where: { id }, data: { status: 'cancelled' } })

  if (wasActive) {
    const cancelledBy = session.id === hangout.userId ? hangout.user.name : 'a moderator'
    for (const j of hangout.joins) {
      // Don't notify the canceller themselves (e.g. host cancels — they know).
      if (j.userId === session.id) continue
      createNotification(
        j.userId,
        'hangout_cancelled',
        `❌ Hangout cancelled`,
        `${cancelledBy} cancelled "${hangout.title}" — check the feed for other plans`,
        `/hangouts`,
      ).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}
