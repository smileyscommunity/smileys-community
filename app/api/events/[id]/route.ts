import { NextRequest, NextResponse } from 'next/server'
import { getEventById } from '@/lib/db'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isAdminOrModerator } from '@/lib/access'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await getEventById(id)
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = await getSession()

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
    const { whatsappUrl, meetingUrl, address, ...publicEvent } = event as any
    return NextResponse.json(publicEvent)
  }

  return NextResponse.json(event)
}
