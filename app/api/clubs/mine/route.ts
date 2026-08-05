import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// The viewer's joined clubs, light shape — feeds the "share with a club"
// selects on the Hangout and Board composers (Clubs brief §29/§30).
// /api/clubs/memberships returns ids only and /api/clubs is the heavy
// discovery payload; the composers just need names.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await prisma.clubMembership.findMany({
    where:  { userId: session.id, status: 'approved', club: { isActive: true } },
    select: { club: { select: { id: true, slug: true, name: true, emoji: true } } },
    orderBy: { joinedAt: 'desc' },
  })
  return NextResponse.json({ clubs: rows.map(r => r.club) })
}
