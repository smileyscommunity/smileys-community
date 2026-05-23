import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

type Params = { params: Promise<{ id: string }> }

export async function GET(_: NextRequest, { params }: Params) {
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

  const attended = await prisma.eventAttendee.findFirst({
    where: { eventId: id, userId: session.id, status: 'approved' },
  })
  if (!attended) return NextResponse.json({ error: 'You must have attended this event' }, { status: 403 })

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
