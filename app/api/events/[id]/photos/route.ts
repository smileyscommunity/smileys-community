import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { firstNameOf } from '@/lib/data'

type Params = { params: Promise<{ id: string }> }

export async function GET(_: NextRequest, { params }: Params) {
  // Member-only: photos include uploader identity, and only attendees can
  // upload — an unauthenticated list would leak the de-facto attendee roster
  // that the guest event view deliberately hides.
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const photos = await prisma.eventPhoto.findMany({
    where: { eventId: id },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })
  return NextResponse.json(photos)
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Approved attendees can add photos — plus the host and cohosts, who run the
  // event but aren't in the attendee list (so an attendee-only check locked
  // them out of their own event's gallery). Admins too.
  const [attended, event, cohost] = await Promise.all([
    prisma.eventAttendee.findFirst({ where: { eventId: id, userId: session.id, status: 'approved' } }),
    prisma.event.findUnique({ where: { id }, select: { hostId: true } }),
    prisma.eventCoHost.findFirst({ where: { eventId: id, userId: session.id }, select: { id: true } }),
  ])
  const allowed = !!attended || event?.hostId === session.id || !!cohost || session.role === 'admin'
  if (!allowed) return NextResponse.json({ error: 'You must have attended this event' }, { status: 403 })

  const { url, caption } = await req.json()
  // Must be a path produced by our own upload route — same regex as profilePhoto in auth/me.
  if (typeof url !== 'string' ||
      !/^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(url)) {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }

  const photo = await prisma.eventPhoto.create({
    data: { eventId: id, userId: session.id, url, caption: caption ?? null },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })

  // Tell everyone attached to the event (approved attendees + host +
  // cohosts, minus the uploader). Fire-and-forget so the uploader's
  // response isn't held hostage by N inserts + pushes; createNotification
  // bundles bursts (one evolving "N new photos" per attendee per 6h) and
  // respects each member's joinedEvents notification preference.
  ;(async () => {
    const [ev, attendees, cohosts] = await Promise.all([
      prisma.event.findUnique({ where: { id }, select: { title: true, hostId: true } }),
      prisma.eventAttendee.findMany({ where: { eventId: id, status: 'approved' }, select: { userId: true } }),
      prisma.eventCoHost.findMany({ where: { eventId: id }, select: { userId: true } }),
    ])
    if (!ev) return
    const recipients = new Set<string>([...attendees.map(a => a.userId), ev.hostId, ...cohosts.map(c => c.userId)])
    recipients.delete(session.id)
    const firstName = firstNameOf(session.name)
    for (const uid of recipients) {
      await createNotification(uid, 'event_photos', '📸 New photo added',
        `${firstName} added a photo to "${ev.title}"`, `/events/${id}`)
    }
  })().catch(err => console.error('[event photos] notification fan-out failed', { id, err: String(err) }))

  return NextResponse.json(photo)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { photoId } = await req.json()

  const photo = await prisma.eventPhoto.findUnique({ where: { id: photoId } })
  if (!photo || photo.eventId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (photo.userId !== session.id && session.role !== 'admin' && session.role !== 'moderator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.eventPhoto.delete({ where: { id: photoId } })
  return NextResponse.json({ ok: true })
}
