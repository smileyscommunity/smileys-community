import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admins see all clubs
  if (isAdmin(session)) {
    const clubs = await prisma.club.findMany({
      select: { id: true, name: true, emoji: true, slug: true, memberCount: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(clubs)
  }

  // Everyone else (hosts, moderators) sees only clubs they are assigned to
  const memberships = await prisma.clubMembership.findMany({
    where: { userId: session.id, role: 'host', status: 'approved' },
    select: { club: { select: { id: true, name: true, emoji: true, slug: true, memberCount: true } } },
    orderBy: { club: { name: 'asc' } },
  })
  return NextResponse.json(memberships.map(m => m.club))
}
