import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { restrictedSetFor } from '@/lib/memberPrivacy'
import { resolveCityId } from '@/lib/city'
import { rateLimit } from '@/lib/rateLimit'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json([], { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 1) return NextResponse.json([])
  // Autocomplete is typed at, so the cap is generous — but a 1-char prefix
  // with no limit was a platform-wide name enumerator.
  if (!await rateLimit(`member-search:${session.id}`, 120, 60_000)) return NextResponse.json([], { status: 429 })

  // A blocked pair sees nothing of each other: the profile route 404s to
  // hide exactly this, and the palette search already excludes them.
  const blocks = await prisma.memberBlock.findMany({
    where:  { OR: [{ blockerId: session.id }, { blockedId: session.id }] },
    select: { blockerId: true, blockedId: true },
  })
  const blockedIds = blocks.map(b => (b.blockerId === session.id ? b.blockedId : b.blockerId))

  const users = await prisma.user.findMany({
    where: {
      status: 'approved',
      // Admin-hidden accounts stay out of mention autocomplete too —
      // surfacing them here would leak what the directory hides.
      hiddenFromMembers: false,
      // Mentions are for people in the room: the viewer's city.
      cityId: await resolveCityId(session),
      id:     { notIn: [session.id, ...blockedIds] },
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
