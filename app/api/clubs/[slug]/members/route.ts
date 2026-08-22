import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { restrictedSetFor } from '@/lib/memberPrivacy'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await params
  const pending = req.nextUrl.searchParams.get('pending') === '1'

  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (pending) {
    // Only hosts/admins can see pending requests
    const isAdmin = isAdminOrModerator(session)
    if (!isAdmin) {
      const membership = await prisma.clubMembership.findUnique({
        where: { userId_clubId: { userId: session.id, clubId: club.id } },
        select: { role: true, status: true },
      })
      if (membership?.role !== 'host' || membership?.status !== 'approved') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const requests = await prisma.clubMembership.findMany({
      where: { clubId: club.id, status: 'pending' },
      orderBy: { joinedAt: 'asc' },
      select: {
        joinedAt: true,
        user: { select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true, bio: true } },
      },
    })

    return NextResponse.json(requests.map(r => ({
      id:           r.user.id,
      name:         r.user.name,
      color:        r.user.color,
      photo:        r.user.profilePhoto,
      neighborhood: r.user.neighborhood,
      bio:          r.user.bio,
      requestedAt:  r.joinedAt,
    })))
  }

  const [memberships, connections] = await Promise.all([
    prisma.clubMembership.findMany({
      where: { clubId: club.id, status: 'approved', user: { status: { not: 'banned' }, hiddenFromMembers: false } },
      orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
      select: {
        role: true,
        joinedAt: true,
        user: {
          select: {
            id: true, name: true, color: true,
            profilePhoto: true, neighborhood: true,
            profileVisibility: true,
          },
        },
      },
    }),
    prisma.memberConnection.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: session.id }, { receiverId: session.id }],
      },
      select: { requesterId: true, receiverId: true },
    }),
  ])

  const connectedIds = new Set(
    connections.map(c => c.requesterId === session.id ? c.receiverId : c.requesterId)
  )
  connectedIds.add(session.id)

  // 'Connections only' members 404 on /members/[id] for non-connected
  // viewers — flag them so the client doesn't render a dead profile link.
  const restricted = await restrictedSetFor(session, memberships.map(m => m.user))

  return NextResponse.json(memberships.map(m => {
    const connected = connectedIds.has(m.user.id)
    return {
      role:         m.role,
      id:           m.user.id,
      firstName:    m.user.name.split(' ')[0],
      fullName:     connected ? m.user.name : null,
      color:        m.user.color,
      photo:        m.user.profilePhoto,
      neighborhood: connected ? m.user.neighborhood : null,
      connected,
      viewable:     !restricted.has(m.user.id),
    }
  }))
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit — approve/reject path fires a notification on each
  // call, and a runaway batch script would notification-spam
  // affected members. 30/min is generous for legit moderation.
  if (!await rateLimit(`club-members-patch:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { slug } = await params
  const { userId, action } = await req.json() as { userId: string; action: 'approve' | 'reject' }

  if (!userId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Must be a host of this club or an admin
  const isAdmin = isAdminOrModerator(session)
  if (!isAdmin) {
    const hostMembership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { role: true, status: true },
    })
    if (hostMembership?.role !== 'host' || hostMembership?.status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (action === 'approve') {
    // Status flip + counter in one transaction — and the increment only
    // fires when the flip actually landed (count > 0), so a double-click
    // can't bump the counter twice.
    const count = await prisma.$transaction(async tx => {
      const r = await tx.clubMembership.updateMany({
        where: { userId, clubId: club.id, status: 'pending' },
        data: { status: 'approved' },
      })
      if (r.count > 0) {
        await tx.club.update({ where: { id: club.id }, data: { memberCount: { increment: 1 } } })
      }
      return r.count
    })
    if (count === 0) return NextResponse.json({ error: 'No pending request found' }, { status: 404 })
    await createNotification(
      userId, 'club_approved', 'Club request approved',
      `Your request to join "${club.name}" was approved! 🎉`, `/clubs/${club.slug}`
    )
  } else {
    const { count } = await prisma.clubMembership.deleteMany({
      where: { userId, clubId: club.id, status: 'pending' },
    })
    if (count === 0) return NextResponse.json({ error: 'No pending request found' }, { status: 404 })
    await createNotification(
      userId, 'club_approved', 'Club request update',
      `Your request to join "${club.name}" was not approved this time.`, `/clubs`
    )
  }

  return NextResponse.json({ ok: true })
}
