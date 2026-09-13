import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { authorProjector } from '@/lib/authorProjection'

type Params = { params: Promise<{ slug: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    // Member-only, same as /api/events/[id]/reviews: only past attendees can
    // review, so the reviewer list is a de-facto attendance list — don't
    // expose it to unauthenticated callers.
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { slug } = await params
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
    if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // The tab is members-only; the API behind it answered any signed-in
    // member. Same audience as the club page's member content: approved
    // members, admins and moderators.
    if (session.role !== 'admin' && session.role !== 'moderator') {
      const membership = await prisma.clubMembership.findUnique({
        where:  { userId_clubId: { userId: session.id, clubId: club.id } },
        select: { status: true },
      })
      if (membership?.status !== 'approved') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const reviews = await prisma.review.findMany({
      where: { event: { clubId: club.id }, user: { status: 'approved' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rating: true,
        text: true,
        createdAt: true,
        user:  { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true, hiddenFromMembers: true } },
        event: { select: { id: true, title: true } },
      },
    })

    // A review is proof of attendance. Someone who RSVP'd in stealth, or whose
    // account is hidden from members, was named here to the whole club; their
    // review stays and they don't. Everyone else follows the shared author rule
    // (a connections-only reviewer is a first name to members they aren't
    // connected to — lib/authorProjection).
    const stealth = reviews.length === 0 ? new Set<string>() : new Set((await prisma.eventAttendee.findMany({
      where:  { stealth: true, eventId: { in: [...new Set(reviews.map(r => r.event.id))] }, userId: { in: [...new Set(reviews.map(r => r.user.id))] } },
      select: { userId: true, eventId: true },
    })).map(a => `${a.userId}:${a.eventId}`))
    const project = await authorProjector(session, reviews.map(r => r.user))

    return NextResponse.json({
      reviews: reviews.map(r => {
        const anonymous = r.user.id !== session.id && (r.user.hiddenFromMembers || stealth.has(`${r.user.id}:${r.event.id}`))
        return {
          ...r,
          user: anonymous
            ? { id: 'member', name: 'A member who went', color: '#9ca3af', profilePhoto: null }
            : project(r.user),
        }
      }),
    })
  } catch (e) {
    console.error('[club reviews GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
