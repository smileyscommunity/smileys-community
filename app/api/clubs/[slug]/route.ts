import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getClubBySlug, getEventsByClub, redactEventForGuest, projectEventsForMember } from '@/lib/db'
import { getSession } from '@/lib/session'
import { canActInCity } from '@/lib/access'

// The club's WhatsApp invite link is the payoff of joining, and the spotlight
// is member content: both go only to approved members and the city's staff —
// the page says so, and this route used to hand them to any session (and the
// spotlight to guests). Membership row ids and counts never leave.
export async function GET(_: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const club = await getClubBySlug(slug)
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const events = await getEventsByClub(club.id)
  const session = await getSession()

  const inside = !!session && (canActInCity(session, club.cityId ?? null) || !!(await prisma.clubMembership.findUnique({
    where:  { userId_clubId: { userId: session.id, clubId: club.id } },
    select: { status: true },
  }).then(m => m?.status === 'approved')))

  const { memberships: _m, _count: _c, templateKey: _t, ...rest } = club as typeof club & { memberships?: unknown; _count?: unknown; templateKey?: unknown }
  const projected = inside ? rest : {
    ...rest, whatsappUrl: null, spotlightUserId: null, spotlightNote: null, spotlightUpdatedAt: null,
    ...(session ? {} : { rules: null }),
  }
  if (session) return NextResponse.json({ club: projected, events: await projectEventsForMember(events, session) })
  return NextResponse.json({ club: projected, events: events.map(redactEventForGuest) })
}
