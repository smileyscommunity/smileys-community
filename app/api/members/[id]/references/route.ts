import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, isClubHost } from '@/lib/access'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    // Same privacy + block gate as the profile route (app/api/members/[id]).
    // References reveal who vouched for a member, so they must not leak past a
    // 'connections only' profile or a block. Viewing your own is always fine;
    // admins/mods/club hosts are exempt from the connections gate. 404 (not
    // 403) so a blocker/blocked or a private profile isn't confirmable.
    if (session.id !== id) {
      const [target, connection, blocked] = await Promise.all([
        prisma.user.findUnique({ where: { id }, select: { profileVisibility: true } }),
        prisma.memberConnection.findFirst({
          where: { OR: [
            { requesterId: session.id, receiverId: id },
            { requesterId: id, receiverId: session.id },
          ] },
          select: { status: true },
        }),
        prisma.memberBlock.findFirst({
          where: { OR: [
            { blockerId: session.id, blockedId: id },
            { blockerId: id, blockedId: session.id },
          ] },
          select: { id: true },
        }),
      ])
      if (blocked) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (
        target?.profileVisibility === 'connections' &&
        connection?.status !== 'accepted' &&
        !isAdminOrModerator(session) &&
        !(await isClubHost(session.id))
      ) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
    }

    const refs = await prisma.hangoutReference.findMany({
      where: { toUserId: id, vibe: 'good' },
      select: {
        id:        true,
        createdAt: true,
        fromUser:  { select: { id: true, name: true, color: true } },
        hangout:   { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    return NextResponse.json(refs)
  } catch (e) {
    console.error('[members references GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
