import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

type Params = { params: Promise<{ slug: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isPrivileged = isAdminOrModerator(session)
  if (!isPrivileged) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { role: true, status: true },
    })
    if (membership?.role !== 'host' || membership?.status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { rules } = await req.json()
  if (typeof rules !== 'string') return NextResponse.json({ error: 'rules must be a string' }, { status: 400 })
  if (rules.length > 5000) return NextResponse.json({ error: 'Rules too long (max 5000 chars)' }, { status: 400 })

  await prisma.club.update({ where: { id: club.id }, data: { rules: rules.trim() || null } })

  return NextResponse.json({ ok: true })
}
