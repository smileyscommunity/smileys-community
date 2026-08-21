import { NextRequest, NextResponse } from 'next/server'
import { getClubBySlug, getEventsByClub, redactEventForGuest } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function GET(_: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const club = await getClubBySlug(slug)
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const events = await getEventsByClub(club.id)
  // Logged-out viewers get the same guest projection as /api/events —
  // no street address/GPS, no chat/meeting links, no attendee identities —
  // and the club's own WhatsApp invite link is withheld with them.
  const session = await getSession()
  if (session) return NextResponse.json({ club, events })
  return NextResponse.json({
    club: { ...club, whatsappUrl: null },
    events: events.map(redactEventForGuest),
  })
}
