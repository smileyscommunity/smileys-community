import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { restrictedSetFor } from '@/lib/memberPrivacy'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json([], { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 1) return NextResponse.json([])

  const users = await prisma.user.findMany({
    where: {
      status: 'approved',
      // Admin-hidden accounts stay out of mention autocomplete too —
      // surfacing them here would leak what the directory hides.
      hiddenFromMembers: false,
      id:     { not: session.id },
      name:   { startsWith: q, mode: 'insensitive' },
    },
    select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true },
    take:    6,
    orderBy: { name: 'asc' },
  })

  // Flag 'connections only' members the viewer can't fully see, so the
  // UI can show a 🔒 hint. Name still returned (search-by-name needs it);
  // only the lock indicator is added.
  const restricted = await restrictedSetFor(session, users)

  return NextResponse.json(users.map(u => ({
    id:         u.id,
    name:       u.name,
    color:      u.color,
    photo:      u.profilePhoto,
    restricted: restricted.has(u.id),
  })))
}
