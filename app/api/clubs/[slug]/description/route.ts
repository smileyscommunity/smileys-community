import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string }> }

// Inline "About this club" editing from the club page — mirrors the
// rules route so admins don't have to round-trip through /admin/clubs.
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  if (!await rateLimit(`club-description:${session.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Platform admins/moderators only — same policy as club rules.
  if (!isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { description } = await req.json()
  if (typeof description !== 'string') {
    return NextResponse.json({ error: 'description must be a string' }, { status: 400 })
  }
  if (description.length > 2000) {
    return NextResponse.json({ error: 'Description too long (max 2000 chars)' }, { status: 400 })
  }
  if (!description.trim()) {
    return NextResponse.json({ error: 'Description cannot be empty' }, { status: 400 })
  }

  await prisma.club.update({ where: { id: club.id }, data: { description: description.trim() } })

  return NextResponse.json({ ok: true })
}
