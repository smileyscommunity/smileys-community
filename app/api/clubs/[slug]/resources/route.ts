import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canActInCity } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string }> }

export async function GET(_: NextRequest, { params }: Params) {
  // Member-only: hosts routinely store the group-chat invite as a resource,
  // which would re-leak what the guest projection of /api/clubs withholds.
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Having a session was the whole gate, so any member — including someone
  // whose request to a private club is still pending — could read the invite
  // link. Same rule as the club page: approved members, admins, moderators.
  if (session.role !== 'admin' && session.role !== 'moderator') {
    const membership = await prisma.clubMembership.findUnique({
      where:  { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true },
    })
    if (membership?.status !== 'approved') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const resources = await prisma.clubResource.findMany({
    where: { clubId: club.id },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json(resources)
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  // Rate limit per-user. Host-only mutation downstream, but
  // resources are member-visible content so a runaway client
  // shouldn't be able to fan them out at script speed.
  if (!await rateLimit(`club-resources:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, cityId: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Staff override is city-scoped like the rules/description/members PATCH
  // siblings — a moderator from another city is not staff for this club.
  const isPrivileged = canActInCity(session, club.cityId)
  if (!isPrivileged) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { role: true, status: true },
    })
    if (membership?.role !== 'host' || membership?.status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { title, url, emoji } = await req.json().catch(() => ({}))
  // Non-string input used to reach .trim() and 500.
  if (typeof title !== 'string' || typeof url !== 'string' || (emoji != null && typeof emoji !== 'string')) {
    return NextResponse.json({ error: 'title and url must be strings' }, { status: 400 })
  }
  // An emoji is a handful of code units (ZWJ sequences run ~11); anything
  // longer is text smuggled into the icon slot.
  if (emoji && emoji.trim().length > 16) return NextResponse.json({ error: 'Emoji too long' }, { status: 400 })
  if (!title.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (title.trim().length > 200) return NextResponse.json({ error: 'Title too long (max 200 chars)' }, { status: 400 })
  if (!url.trim()) return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  const trimmedUrl = url.trim()
  if (trimmedUrl.length > 1000) return NextResponse.json({ error: 'URL too long (max 1000 chars)' }, { status: 400 })
  if (!trimmedUrl.startsWith('https://')) {
    return NextResponse.json({ error: 'URL must start with https://' }, { status: 400 })
  }

  const last = await prisma.clubResource.findFirst({
    where: { clubId: club.id },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  const nextOrder = (last?.order ?? -1) + 1

  const resource = await prisma.clubResource.create({
    data: {
      clubId: club.id,
      title:  title.trim(),
      url:    url.trim(),
      emoji:  emoji?.trim() || '🔗',
      order:  nextOrder,
    },
  })

  return NextResponse.json(resource, { status: 201 })
}
