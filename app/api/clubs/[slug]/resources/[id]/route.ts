import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string; id: string }> }

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  if (!await rateLimit(`resource-delete:${session.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many deletions' }, { status: 429 })
  }

  const { slug, id } = await params
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

  await prisma.clubResource.deleteMany({ where: { id, clubId: club.id } })
  return NextResponse.json({ ok: true })
}
