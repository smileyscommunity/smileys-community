import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, isClubHost } from '@/lib/access'
import { authorProjector } from '@/lib/authorProjection'

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
    // The member themselves must be one the profile page would show: approved,
    // and for anyone but staff not suspended.
    const staff = isAdminOrModerator(session)
    const member = await prisma.user.findUnique({
      where: { id }, select: { status: true, suspendedUntil: true },
    })
    if (!member || member.status !== 'approved' || (session.id !== id && !staff &&
        member.suspendedUntil && member.suspendedUntil > new Date())) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

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
        !staff &&
        !(await isClubHost(session.id))
      ) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
    }

    // Who vouched is shown the way they'd be shown anywhere else: a banned,
    // hidden or suspended author isn't named, nor one the viewer has a block
    // with, and a connections-only author the viewer isn't connected to is a
    // first name.
    const blocks = await prisma.memberBlock.findMany({
      where:  { OR: [{ blockerId: session.id }, { blockedId: session.id }] },
      select: { blockerId: true, blockedId: true },
    })
    const blockedIds = blocks.map(b => b.blockerId === session.id ? b.blockedId : b.blockerId)
    const refs = await prisma.hangoutReference.findMany({
      where: {
        toUserId: id, vibe: 'good',
        fromUserId: { notIn: blockedIds },
        fromUser: {
          status: 'approved', hiddenFromMembers: false,
          OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],
        },
      },
      select: {
        id:        true,
        createdAt: true,
        fromUser:  { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } },
        hangout:   { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    const show = await authorProjector(session, refs.map(r => r.fromUser))
    return NextResponse.json(refs.map(r => {
      const a = show(r.fromUser)
      return { ...r, fromUser: { id: a.id, name: a.name, color: a.color } }
    }))
  } catch (e) {
    console.error('[members references GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
