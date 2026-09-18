import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canActInCity } from '@/lib/access'
import { authorProjector } from '@/lib/authorProjection'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string }> }

export async function GET(_: NextRequest, { params }: Params) {
  // Member-only: event-photo uploaders attended those events, so the
  // author list is a de-facto attendance list — same rule as reviews.
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, cityId: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // The gallery is for the club's approved members and the city's staff —
  // the page hides it from everyone else, and this route didn't.
  if (!canActInCity(session, club.cityId)) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true },
    })
    if (membership?.status !== 'approved') return NextResponse.json({ error: 'Members only' }, { status: 403 })
  }

  const AUTHOR = { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true, hiddenFromMembers: true, status: true } }
  const [clubPhotos, eventPhotos] = await Promise.all([
    prisma.clubPhoto.findMany({
      where: { clubId: club.id },
      orderBy: { createdAt: 'desc' },
      include: { user: AUTHOR },
    }),
    prisma.eventPhoto.findMany({
      where: { event: { clubId: club.id } },
      orderBy: { createdAt: 'desc' },
      include: {
        user:  AUTHOR,
        event: { select: { title: true } },
      },
    }),
  ])
  // Connections-only and hidden uploaders are shown the way the roster shows them.
  const show = await authorProjector(session, [...clubPhotos.map(p => p.user), ...eventPhotos.map(p => p.user)])

  const merged = [
    ...clubPhotos.map(p => ({
      id:        p.id,
      url:       p.url,
      caption:   p.caption,
      createdAt: p.createdAt,
      source:    'club' as const,
      author:    (() => { const u = show(p.user); return { id: u.id, name: u.name, color: u.color, photo: u.profilePhoto } })(),
    })),
    ...eventPhotos.map(p => ({
      id:        p.id,
      url:       p.url,
      caption:   p.caption ?? null,
      createdAt: p.createdAt,
      source:    'event' as const,
      // An event photo's uploader is an attendee — possibly a stealth one —
      // so the club gallery credits the event, not the person.
      author:    { id: '', name: p.event.title, color: '#d1d5db', photo: null },
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return NextResponse.json(merged)
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  if (!await rateLimit(`photo-upload:${session.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many uploads' }, { status: 429 })
  }

  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, isActive: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (club.isActive === false) return NextResponse.json({ error: 'This club is no longer active' }, { status: 409 })

  if (!isAdmin(session)) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true },
    })
    if (membership?.status !== 'approved') {
      return NextResponse.json({ error: 'Join this club to upload photos' }, { status: 403 })
    }
  }

  const { url, caption } = await req.json().catch(() => ({}))
  // Wrong types used to reach .trim() and 500.
  if (typeof url !== 'string' || (caption != null && typeof caption !== 'string')) {
    return NextResponse.json({ error: 'url and caption must be strings' }, { status: 400 })
  }
  if (!url.trim()) return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  if (!/^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(url.trim())) {
    return NextResponse.json({ error: 'Invalid photo URL' }, { status: 400 })
  }
  if (caption && caption.trim().length > 300) return NextResponse.json({ error: 'Caption too long (max 300 chars)' }, { status: 400 })

  const photo = await prisma.clubPhoto.create({
    data: { clubId: club.id, userId: session.id, url: url.trim(), caption: caption?.trim() || null },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })

  return NextResponse.json({
    id:        photo.id,
    url:       photo.url,
    caption:   photo.caption,
    createdAt: photo.createdAt,
    author: { id: photo.user.id, name: photo.user.name, color: photo.user.color, photo: photo.user.profilePhoto },
  }, { status: 201 })
}
