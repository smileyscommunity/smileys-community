import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string }> }

export async function POST(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`club-join:${session.id}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const user = await prisma.user.findUnique({ where: { id: session.id }, select: { status: true } })
    if (!user || user.status !== 'approved') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { slug } = await params
    const club = await prisma.club.findUnique({ where: { slug } })
    if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const status = club.isPrivate ? 'pending' : 'approved'

    const membership = await prisma.clubMembership.create({
      data: { userId: session.id, clubId: club.id, status },
    })

    // Only increment memberCount for approved (public) clubs
    if (!club.isPrivate) {
      await prisma.club.update({
        where: { id: club.id },
        data: { memberCount: { increment: 1 } },
      })
    }

    // Notify the club's hosts when someone requests to join a private club
    if (club.isPrivate) {
      const requester = await prisma.user.findUnique({ where: { id: session.id }, select: { name: true } })
      const hosts = await prisma.clubMembership.findMany({
        where: { clubId: club.id, role: 'host', status: 'approved' },
        select: { userId: true },
      })
      await Promise.all(hosts.map(h =>
        createNotification(h.userId, 'club_approved', 'New join request',
          `${requester?.name ?? 'A member'} wants to join "${club.name}"`, `/host/clubs/${club.slug}`)
      ))
    }

    return NextResponse.json({ ok: true, status })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'Already a member' }, { status: 409 })
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { slug } = await params
    const club = await prisma.club.findUnique({ where: { slug } })
    if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const membership = await prisma.clubMembership.delete({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
    })

    // Only decrement if they were an approved member
    if (membership.status === 'approved') {
      await prisma.club.update({
        where: { id: club.id },
        data: { memberCount: { decrement: 1 } },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
