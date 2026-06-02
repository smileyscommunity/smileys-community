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
  const { userId, role } = await req.json()
  if (!userId || !role) return NextResponse.json({ error: 'userId and role required' }, { status: 400 })

  const [membership, club] = await Promise.all([
    prisma.clubMembership.upsert({
      where: { userId_clubId: { userId, clubId } },
      create: { userId, clubId, role, status: 'approved' },
      update: { role, status: 'approved' },
    }),
    prisma.club.findUnique({ where: { id: clubId }, select: { name: true, slug: true } }),
  ])

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
