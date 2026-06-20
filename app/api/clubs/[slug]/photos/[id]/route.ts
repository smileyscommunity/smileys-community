import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ slug: string; id: string }> }

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  if (!await rateLimit(`photo-delete:${session.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many deletions' }, { status: 429 })
  }

  const { slug, id } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const photo = await prisma.clubPhoto.findUnique({ where: { id }, select: { userId: true, clubId: true } })
  if (!photo || photo.clubId !== club.id) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })

  const isOwn = photo.userId === session.id
  if (!isOwn && !isAdmin(session)) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { role: true, status: true },
    })
    if (membership?.role !== 'host' || membership?.status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const adminOverride = !isOwn && isAdmin(session)
  await prisma.clubPhoto.delete({ where: { id } })

  if (adminOverride) {
    writeAudit(session.id, session.name, 'club_photo_delete', id, 'ClubPhoto', {
      clubSlug: slug,
      photoOwnerId: photo.userId,
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
