import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { createNotification } from '@/lib/notify'

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
      where: { clubId: club.id, status: 'approved' },
      orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
      select: {
        role: true,
        joinedAt: true,
        user: {
          select: {
            id: true, name: true, color: true,
            profilePhoto: true, neighborhood: true,
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
    }
  }))
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    await prisma.clubMembership.update({
      where: { userId_clubId: { userId, clubId: club.id } },
      data: { status: 'approved' },
    })
    await prisma.club.update({ where: { id: club.id }, data: { memberCount: { increment: 1 } } })
    await createNotification(
      userId, 'club_approved', 'Club request approved',
      `Your request to join "${club.name}" was approved! 🎉`, `/clubs/${club.slug}`
    )
  } else {
    await prisma.clubMembership.delete({
      where: { userId_clubId: { userId, clubId: club.id } },
    })
    await createNotification(
      userId, 'club_approved', 'Club request update',
      `Your request to join "${club.name}" was not approved this time.`, `/clubs`
    )
  }

  return NextResponse.json({ ok: true })
}
