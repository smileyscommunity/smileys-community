import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string }> }

export async function GET(_: NextRequest, { params }: Params) {
  // Member-only: exposes a member's bio beyond card-level data, and
  // profileVisibility isn't consulted here — don't serve it to guests.
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await params
  const club = await prisma.club.findUnique({
    where: { slug },
    select: {
      spotlightUserId: true,
      spotlightNote: true,
      spotlightUpdatedAt: true,
      spotlightUser: { select: { id: true, name: true, color: true, profilePhoto: true, bio: true } },
    },
  })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!club.spotlightUser) return NextResponse.json(null)

  return NextResponse.json({
    userId:    club.spotlightUser.id,
    name:      club.spotlightUser.name,
    color:     club.spotlightUser.color,
    photo:     club.spotlightUser.profilePhoto,
    bio:       club.spotlightUser.bio,
    note:      club.spotlightNote,
    updatedAt: club.spotlightUpdatedAt,
  })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  if (!await rateLimit(`spotlight:${session.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!isAdmin(session)) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { role: true, status: true },
    })
    if (membership?.role !== 'host' || membership?.status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { userId, name, note } = await req.json()
  if (!userId && !name?.trim()) return NextResponse.json({ error: 'Member required' }, { status: 400 })
  if (note && note.trim().length > 500) return NextResponse.json({ error: 'Note too long (max 500 chars)' }, { status: 400 })

  const found = await prisma.clubMembership.findFirst({
    where: {
      clubId: club.id,
      status: 'approved',
      ...(userId
        ? { userId }
        : { user: { name: { contains: name.trim(), mode: 'insensitive' } } }
      ),
    },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, bio: true } } },
  })
  if (!found) return NextResponse.json({ error: 'No approved member found' }, { status: 404 })

  await prisma.club.update({
    where: { id: club.id },
    data: {
      spotlightUserId:    found.userId,
      spotlightNote:      note?.trim() ?? null,
      spotlightUpdatedAt: new Date(),
    },
  })

  return NextResponse.json({
    userId:    found.user.id,
    name:      found.user.name,
    color:     found.user.color,
    photo:     found.user.profilePhoto,
    bio:       found.user.bio,
    note:      note?.trim() ?? null,
    updatedAt: new Date(),
  })
}
