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

    // Membership write + counter in one transaction (the admin memberships
    // route's rule) — a crash between them left memberCount drifted with
    // nothing but the manual recount button to notice. Counter moves only
    // for approved (public-club) joins.
    const [membership] = await prisma.$transaction([
      prisma.clubMembership.create({
        data: { userId: session.id, clubId: club.id, status },
      }),
      ...(!club.isPrivate ? [prisma.club.update({
        where: { id: club.id },
        data: { memberCount: { increment: 1 } },
      })] : []),
    ])

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

// Self-demote: a host can step down to a regular member while keeping
// their club membership (so they don't have to leave the club just to
// stop hosting). Only your own membership, only host → member.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    if (body.role !== 'member') {
      return NextResponse.json({ error: 'Only stepping down to member is supported' }, { status: 400 })
    }

    const { slug } = await params
    const club = await prisma.club.findUnique({ where: { slug } })
    if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const membership = await prisma.clubMembership.findUnique({
      where:  { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { role: true, status: true },
    })
    if (!membership || membership.role !== 'host') {
      return NextResponse.json({ error: 'You are not a host of this club' }, { status: 400 })
    }

    // Don't orphan the club — require another host before stepping down.
    const hostCount = await prisma.clubMembership.count({
      where: { clubId: club.id, role: 'host', status: 'approved' },
    })
    if (hostCount <= 1) {
      return NextResponse.json({ error: 'You are the only host. Assign another host or contact an admin before stepping down.' }, { status: 400 })
    }

    await prisma.clubMembership.update({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      data:  { role: 'member' },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
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

    const membership = await prisma.clubMembership.findUnique({
      where:  { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { role: true, status: true },
    })
    if (!membership) return NextResponse.json({ ok: true })

    // Don't orphan the club — the last host must hand off before leaving.
    if (membership.role === 'host' && membership.status === 'approved') {
      const hostCount = await prisma.clubMembership.count({
        where: { clubId: club.id, role: 'host', status: 'approved' },
      })
      if (hostCount <= 1) {
        return NextResponse.json({ error: 'You are the only host. Assign another host or contact an admin before leaving.' }, { status: 400 })
      }
    }

    // Delete + counter atomically; decrement only if they were approved.
    await prisma.$transaction([
      prisma.clubMembership.delete({
        where: { userId_clubId: { userId: session.id, clubId: club.id } },
      }),
      ...(membership.status === 'approved' ? [prisma.club.update({
        where: { id: club.id },
        data: { memberCount: { decrement: 1 } },
      })] : []),
    ])

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
