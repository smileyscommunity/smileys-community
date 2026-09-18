import { canManageClubs } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function GET(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManageClubs(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: clubId } = await params

  const memberships = await prisma.clubMembership.findMany({
    where: { clubId, status: 'approved' },
    select: {
      role: true,
      user: { select: { id: true, name: true, color: true, profilePhoto: true } },
    },
    orderBy: { joinedAt: 'asc' },
  })

  return NextResponse.json(memberships)
}

// Assign or update a member's role in a club
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManageClubs(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: clubId } = await params
  const { userId, role } = await req.json().catch(() => ({}))
  if (typeof userId !== 'string' || !userId || (role !== 'member' && role !== 'host')) {
    return NextResponse.json({ error: 'userId and a role of member or host are required' }, { status: 400 })
  }
  const [user, club] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma.club.findUnique({ where: { id: clubId }, select: { name: true, slug: true } }),
  ])
  if (!user || !club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The memberships route's invariant: an approved row and memberCount move
  // together. This upsert created approved rows on every event save with a
  // club and host, and the count drifted by one each time.
  const membership = await prisma.$transaction(async tx => {
    const prior = await tx.clubMembership.findUnique({ where: { userId_clubId: { userId, clubId } }, select: { status: true } })
    const row = await tx.clubMembership.upsert({
      where: { userId_clubId: { userId, clubId } },
      create: { userId, clubId, role, status: 'approved' },
      update: { role, status: 'approved' },
    })
    if (prior?.status !== 'approved') await tx.club.update({ where: { id: clubId }, data: { memberCount: { increment: 1 } } })
    return row
  })

  if (role === 'host' && club) {
    createNotification(
      userId,
      'announcement',
      '🎉 You\'re now a host!',
      `You've been assigned as a host of ${club.name}. You can now create and manage events for this club.`,
      `/clubs/${club.slug}`
    ).catch(console.error)
  }

  return NextResponse.json(membership)
}

// Remove a member from host role (demote to member)
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManageClubs(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: clubId } = await params
  const { userId } = await req.json()

  const [user, club] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.club.findUnique({ where: { id: clubId }, select: { name: true } }),
  ])

  await prisma.clubMembership.update({
    where: { userId_clubId: { userId, clubId } },
    data: { role: 'member' },
  })

  writeAudit(session.id, session.name, 'club.host_remove', userId, 'user',
    { clubId, clubName: club?.name, userName: user?.name },
    `Demoted ${user?.name ?? userId} from host of "${club?.name ?? clubId}" to member`,
  )

  return NextResponse.json({ ok: true })
}
