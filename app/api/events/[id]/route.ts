import { NextRequest, NextResponse } from 'next/server'
import { getEventById, redactEventForGuest, canSeeEvent } from '@/lib/db'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isAdminOrModerator } from '@/lib/access'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await getEventById(id)
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = await getSession()

  // Not-yet-public events exist only for staff, the host and co-hosts.
  if (!(await canSeeEvent(event, session))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Logged-out viewers get the public teaser — also hides GPS + attendee
  // identities, matching the list endpoint's guest projection.
  if (!session) {
    return NextResponse.json(redactEventForGuest(event))
  }

  // The private venue address + chat/meeting links are the payoff of being
  // approved for the event — they must NOT leak to logged-in members who
  // aren't actually attending. Only the host, approved attendees, and
  // admins/mods get the full object; everyone else gets the public view.
  let canSeePrivate = false
  if (session) {
    if (isAdminOrModerator(session) || event.hostId === session.id) {
      canSeePrivate = true
    } else {
      const attendance = await prisma.eventAttendee.findUnique({
        where:  { userId_eventId: { userId: session.id, eventId: id } },
        select: { status: true },
      })
      canSeePrivate = attendance?.status === 'approved'
    }
  }

  if (!canSeePrivate) {
    // lat/lng recover the address trivially — strip them with it.
    const { whatsappUrl, meetingUrl, address, paymentContact, ...publicEvent } = event as any
    return NextResponse.json({ ...publicEvent, lat: null, lng: null })
  }

  // The linked directory listing names the venue, so it rides only with the
  // exact location. The edit forms read it here; `live` says whether the
  // event page shows its chip yet (a pending stub doesn't).
  const link = await prisma.event.findUnique({
    where:  { id },
    select: { business: { select: { id: true, name: true, isApproved: true, isActive: true } } },
  })
  const b = link?.business
  return NextResponse.json({ ...event, venue: b ? { id: b.id, name: b.name, live: b.isApproved && b.isActive } : null })
}
