import { canManageClubs } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const { userId, role = 'member' } = await req.json()

    const membership = await prisma.clubMembership.create({
      data: { userId, clubId: id, role, status: 'approved' },
      include: { user: { select: { id: true, name: true, email: true, color: true, role: true } } },
    })

    await prisma.club.update({
      where: { id },
      data: { memberCount: { increment: 1 } },
    })

    return NextResponse.json(membership)
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'Already a member' }, { status: 409 })
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const memberships = await prisma.clubMembership.findMany({
      where: { clubId: id },
      include: { user: { select: { id: true, name: true, email: true, color: true, role: true } } },
      orderBy: { joinedAt: 'asc' },
    })
    return NextResponse.json(memberships)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const { userId, status, role } = await req.json()

    const data: Record<string, string> = {}
    if (status) data.status = status
    if (role)   data.role   = role

    const membership = await prisma.clubMembership.update({
      where: { userId_clubId: { userId, clubId: id } },
      data,
    })

    const club = await prisma.club.findUnique({ where: { id } })
    if (status === 'approved') {
      await prisma.club.update({ where: { id }, data: { memberCount: { increment: 1 } } })
      createNotification(userId, 'club_approved', 'Membership approved! 🎉', `Your request to join ${club?.name} has been approved`, `/clubs`)
    } else if (status === 'rejected') {
      createNotification(userId, 'club_rejected', 'Membership request declined', `Your request to join ${club?.name} was not approved`, `/clubs`)
    }
    if (role === 'host') {
      createNotification(userId, 'host_assigned', 'You\'re now a host 🎖️', `You've been made a host of ${club?.name ?? 'a club'}. You can now create and manage events.`, `/host`)
    }

    return NextResponse.json(membership)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const { userId } = await req.json()

    const membership = await prisma.clubMembership.delete({
      where: { userId_clubId: { userId, clubId: id } },
    })

    if (membership.status === 'approved') {
      await prisma.club.update({
        where: { id },
        data: { memberCount: { decrement: 1 } },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
