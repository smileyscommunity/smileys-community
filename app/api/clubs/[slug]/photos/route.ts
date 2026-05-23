import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string }> }

export async function GET(_: NextRequest, { params }: Params) {
  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const photos = await prisma.clubPhoto.findMany({
    where: { clubId: club.id },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })

  return NextResponse.json(photos.map(p => ({
    id:        p.id,
    url:       p.url,
    caption:   p.caption,
    createdAt: p.createdAt,
    author: { id: p.user.id, name: p.user.name, color: p.user.color, photo: p.user.profilePhoto },
  })))
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  if (!await rateLimit(`photo-upload:${session.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many uploads' }, { status: 429 })
  }

  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (session.role !== 'admin') {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true },
    })
    if (membership?.status !== 'approved') {
      return NextResponse.json({ error: 'Join this club to upload photos' }, { status: 403 })
    }
  }

  const { url, caption } = await req.json()
  if (!url?.trim()) return NextResponse.json({ error: 'URL is required' }, { status: 400 })
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
